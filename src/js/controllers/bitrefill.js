'use strict';

angular.module('copayAddon.bitrefill').controller('bitrefillController', 
  function($rootScope, $scope, $log, $modal, $timeout, configService, profileService,
           animationService, storageService, feeService, addressService, bwsError, isCordova,
           gettext, refillStatus, lodash, bitrefill, go) {
    
    var configWallet = configService.getSync().wallet,
        currentFeeLevel = 'normal',
        fc = profileService.focusedClient,
        bitrefillConfig,
        self = this;
        
    $scope.isMainnet = (fc.credentials.network === 'livenet');
    
    storageService.getBitrefillConfig(function(err, bitrefillConfig) {
       self.bitrefillConfig = bitrefillConfig || {};
       $scope.amount = self.bitrefillConfig.amount;
       $scope.email = self.bitrefillConfig.email;
       $scope.phone = self.bitrefillConfig.phone;
    });
    
    var lookupNumber = $scope.lookupNumber = function() {
      $scope.error = $scope.btcValueStr = $scope.package = null;
      var operatorSlug = $scope.selectedOp ? $scope.selectedOp.slug : null;
      self.setOngoingProcess(gettext('Looking up operator'));
      bitrefill.lookupNumber($scope.phone, operatorSlug, function(err, result) {
        self.setOngoingProcess();
        if (err) {
            return handleError(err.message || err.error.message || err);
        }
        $log.debug(result);
        $scope.operators = result.altOperators;
        $scope.country = result.country;
        if (result.operator) {
          $scope.operators.push(lodash.pick(result.operator, ['slug', 'name', 'logoImage']));
          $scope.selectedOp = result.operator;
          var packages = result.operator.packages;
          packages.forEach(function(package) {
              package.valueStr = package.value + ' ' + $scope.selectedOp.currency;
              package.btcValueStr = profileService.formatAmount(package.satoshiPrice)
                                  + ' ' + configWallet.settings.unitName;
          });
          $scope.packages = packages;
          if (!result.operator.isRanged) {
            $scope.amount = null;
          } else {
            $scope.package = null;
          }
        }
      });
    };
    
    $scope.geoIpLookup = function(callback) {
      var lookedUp = false,
          defaultCountry = "US";
      $.getJSON('http://ipinfo.io', function(resp) {
        lookedUp = true;
        var countryCode = (resp && resp.country) ? resp.country : defaultCountry;
        callback(countryCode);
      });
      
      $timeout(function() {
          if (!lookedUp) {
            callback(defaultCountry);
          }
      }, 1000);
    };
    
    $scope.openWalletsList = function() {
      go.swipe(true);
    };
    
    $scope.updateBtcValue = function(value, valueSat) {
      if (!value) {
          $scope.btcValueStr = null;
          return;
      }
      
      if (!valueSat) {
        valueSat = value * $scope.selectedOp.range.customerSatoshiPriceRate;
        valueSat = Math.ceil(valueSat / 10000) * 10000;
      }
      $scope.btcValueStr = profileService.formatAmount(valueSat) + ' ' + configWallet.settings.unitName;
    };
    
    var handleError = function(err) {
      $log.error(err);
      
      profileService.lockFC();
      self.setOngoingProcess();
      $scope.error = err;
    };
    
    $scope.isValid = function() {
      var validValue = ($scope.package && $scope.package.value) || $scope.amount;
      return $scope.selectedOp && $scope.email && $scope.phone && validValue;
    };
    
    $scope.placeOrder = function() {
      var formattedPhone = $scope.orderForm.phone.$viewValue;
          
      addressService.getAddress(fc.credentials.walletId, null, function(err, refundAddress) {
        if (!refundAddress) {
          return handleError(bwsError.msg(err, 'Could not create address'));
        }

        self.setOngoingProcess(gettext('Creating order'));
        bitrefill.placeOrder($scope.phone, $scope.selectedOp.slug,
           $scope.amount || $scope.package.value, $scope.email, refundAddress, function(err, result) {

           if (err) {
             return handleError(err);
           }
         
           $log.debug(result);
           $scope.error = null;
           var txOpts = {
             toAddress: result.payment.address,
             amount: result.satoshiPrice,
             customData: { 
               bitrefillOrderId: result.orderId,
               description: result.valuePackage + ' ' + $scope.selectedOp.currency + ' to ' + formattedPhone
             },
             message: 'Refill ' + formattedPhone + ' with '+ result.valuePackage + ' ' + $scope.selectedOp.currency
           }
           self.createAndSendTx(txOpts, function(err, result) {
             self.bitrefillConfig.email = $scope.email;
             self.bitrefillConfig.amount = $scope.amount;
             self.bitrefillConfig.phone = $scope.phone;
             if (err) {
               storageService.setBitrefillConfig(self.bitrefillConfig, function() {});
               return handleError(err);
             }
             storageService.setBitrefillConfig($scope.email, function() {
                go.walletHome();
             });
           })
         });
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
    
    this.createAndSendTx = function(txOpts, cb) {
      var self = this,
          currentSpendUnconfirmed = configWallet.spendUnconfirmed;
      
      if (fc.isPrivKeyEncrypted()) {
        profileService.unlockFC(function(err) {
          if (err) return cb(err);
          return self.createAndSendTx(txOpts, cb);
        });
        return;
      };

      self.setOngoingProcess(gettext('Creating transaction'));
      $timeout(function() {
        feeService.getCurrentFeeValue(currentFeeLevel, function(err, feePerKb) {
          fc.sendTxProposal({
            toAddress: txOpts.toAddress,
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

      }, 100);

    };
    
    this.resetError = function() {
      $scope.error = null;
    };

    this._setOngoingForSigning = function() {
      if (fc.isPrivKeyExternal() && fc.getPrivKeyExternalSourceName() == 'ledger') {
        self.setOngoingProcess(gettext('Requesting Ledger Wallet to sign'));
      } else {
        self.setOngoingProcess(gettext('Signing payment'));
      }
    };

    var _signAndBroadcast = function(txp, cb) {
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
              err = bwsError.msg(err, gettextCatalog.getString('The payment was signed but could not be broadcasted. Please try again from home screen'));
              return cb(err);
            }
            if (memo)
              $log.info(memo);

            refillStatus.notify(btx, function() {
              $scope.$emit('Local/TxProposalAction', true);
              return cb(null, btx);
            });
          });
        } else {
          self.setOngoingProcess();
          refillStatus.notify(signedTx, function() {
            $scope.$emit('Local/TxProposalAction');
            return cb(null, signedTx);
          });
        }
      });
    };
});
