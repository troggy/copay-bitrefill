'use strict';

angular.module('copayAddon.bitrefill').controller('bitrefillController', 
  function($rootScope, $scope, $log, $modal, $timeout, configService, profileService,
           animationService, feeService, addressService, bwsError, isCordova,
           gettext, lodash, bitrefill) {
    
    var configWallet = configService.getSync().wallet,
        currentFeeLevel = configWallet.settings.feeLevel || 'normal'
        self = this;
    $scope.phone = null;
    
    var lookupNumber = $scope.lookupNumber = function(operator) {
      bitrefill.lookup_number($scope.phone, operator, function(err, result) {
        if (err) {
            return;
        }
        console.log(result);
        $scope.operators = result.altOperators;
        $scope.operators.push(lodash.pick(result.operator, ['slug', 'name', 'logoImage']));
        $scope.country = result.country;
        $scope.selectedOp = result.operator;
        var packages = result.operator.packages;
        packages.forEach(function(package) {
            package.valueStr = package.value + ' ' + $scope.selectedOp.currency;
            package.btcValueStr = profileService.formatAmount(package.satoshiPrice)
                                + ' ' + configWallet.settings.unitName;
        });
        $scope.packages = packages;
      });
    };
    
    $scope.placeOrder = function() {
        self.setOngoingProcess(gettext('Creating order'));
        bitrefill.place_order($scope.phone, $scope.selectedOp.slug,
           $scope.package.value, $scope.email, function(err, result) {

         if (err) {
           return;
         }
         
         console.log(result);
         var txOpts = {
           toAddress: result.payment.address,
           amount: result.satoshiPrice,
           customData: { bitrefillOrderId: result.orderId },
           message: 'Refill ' + result.number ' with '+ result.valuePackage + ' ' + $scope.selectedOp.currency;
         }
         self.createTx(txOpts, function(err, result) {
           if (err) {
             $log.error(err);
             
             profileService.lockFC();
             self.setOngoingProcess();
             $scope.error = err;
             return;
           }
           console.log(result);
         })
       });
    };
    
    $scope.openOperatorsModal = function(operators, selectedOp) {
      $rootScope.modalOpened = true;

      var ModalInstanceCtrl = function($scope, $modalInstance) {
        $scope.error = null;
        $scope.loading = null;
        
        $scope.operators = operators;
        $scope.selectedOp = selectedOp;

        $scope.cancel = lodash.debounce(function() {
          $modalInstance.dismiss('cancel');
        }, 0, 1000);
        
        $scope.selectOperator = function(operatorSlug) {
            lookupNumber(operatorSlug);
            $scope.cancel();
        };
        
      };

      var modalInstance = $modal.open({
        templateUrl: 'bitrefill/views/modals/operators.html',
        windowClass: animationService.modalAnimated.slideRight,
        controller: ModalInstanceCtrl,
      });

      var disableCloseModal = $rootScope.$on('closeModal', function() {
        modalInstance.dismiss('cancel');
      });

      modalInstance.result.finally(function() {
        $rootScope.modalOpened = false;
        disableCloseModal();
        var m = angular.element(document.getElementsByClassName('reveal-modal'));
        m.addClass(animationService.modalAnimated.slideOutRight);
      });

      modalInstance.result.then(function(txp) {
        self.setOngoingProcess();
      });

    };
    
    this.setOngoingProcess = function(name) {
      var self = this;
      self.blockUx = !!name;

      if (isCordova) {
        if (name) {
          window.plugins.spinnerDialog.hide();
          window.plugins.spinnerDialog.show(null, name + '...', true);
        } else {
          window.plugins.spinnerDialog.hide();
        }
      } else {
        $scope.loading = name;
        $timeout(function() {
          $rootScope.$apply();
        });
      };
    };
    
    this.createTx = function(txOpts, cb) {
      var self = this,
          fc = profileService.focusedClient,
          currentSpendUnconfirmed = configWallet.spendUnconfirmed;
      
      $scope.error = null;
          
      if (fc.isPrivKeyEncrypted()) {
        profileService.unlockFC(function(err) {
          if (err) return cb(err);
          return self.createTx(txOpts, cb);
        });
        return;
      };

      self.setOngoingProcess(gettext('Creating transaction'));
      $timeout(function() {
        addressService.getAddress(fc.credentials.walletId, null, function(err, refundAddress) {
          if (!refundAddress) {
            return cb(bwsError.msg(err, 'Could not create address'));
          }
          feeService.getCurrentFeeValue(currentFeeLevel, function(err, feePerKb) {
            fc.sendTxProposal({
              toAddress: refundAddress , // txOpts.toAddress,
              amount: txOpts.amount,
              message: txOpts.message,
              customData: txOpts.customData,
              payProUrl: null,
              feePerKb: feePerKb,
              excludeUnconfirmedUtxos: currentSpendUnconfirmed ? false : true
            }, function(err, txp) {
              if (err) {
                return cb(bwsError.msg(err, 'Error'));
              }

              if (!fc.canSign()) {
                self.setOngoingProcess();
                $log.info('No signing proposal: No private key');
                return cb(null, { complete: false });
              }
              
              _signAndBroadcast(txp, function(err) {
                self.setOngoingProcess();
                if (err) {
                  var errorMessage = err.message ? err.message : gettext('The payment was created but could not be completed. Please try again from home screen');
                  $scope.$emit('Local/TxProposalAction');
                  $timeout(function() {
                    $scope.$digest();
                  }, 1);
                  return cb(errorMessage);
                } else {
                  return cb(null, { complete: true })
                }
              });
            });
          });
        });

      }, 100);

    };
    
    this.resetError = function() {
      $scope.error = null;
    };

    this._setOngoingForSigning = function() {
      var fc = profileService.focusedClient;

      if (fc.isPrivKeyExternal() && fc.getPrivKeyExternalSourceName() == 'ledger') {
        self.setOngoingProcess(gettext('Requesting Ledger Wallet to sign'));
      } else {
        self.setOngoingProcess(gettext('Signing payment'));
      }
    };

    var _signAndBroadcast = function(txp, cb) {
      var fc = profileService.focusedClient;

      self._setOngoingForSigning();
      profileService.signTxProposal(txp, function(err, signedTx) {
        self.setOngoingProcess();
        if (err) {
          if (!lodash.isObject(err)) {
            err = { message: err};
          }
          err.message = bwsError.msg(err, gettextCatalog.getString('The payment was created but could not be signed. Please try again from home screen'));
          return cb(err);
        }

        if (signedTx.status == 'accepted') {
          self.setOngoingProcess(gettext('Broadcasting transaction'));
          fc.broadcastTxProposal(signedTx, function(err, btx, memo) {
            self.setOngoingProcess();
            if (err) {
              err.message = bwsError.msg(err, gettextCatalog.getString('The payment was signed but could not be broadcasted. Please try again from home screen'));
              return cb(err);
            }
            if (memo)
              $log.info(memo);

            txStatus.notify(btx, function() {
              $scope.$emit('Local/TxProposalAction', true);
              return cb();
            });
          });
        } else {
          self.setOngoingProcess();
          txStatus.notify(signedTx, function() {
            $scope.$emit('Local/TxProposalAction');
            return cb();
          });
        }
      });
    };
});
