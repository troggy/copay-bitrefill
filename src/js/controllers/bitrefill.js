'use strict';

angular.module('copayAddon.bitrefill').controller('bitrefillController',
  function($rootScope, $scope, $log, $modal, $timeout, configService, profileService,
           animationService, storageService, feeService, addressService, bwsError, isCordova,
           gettext, refillStatus, lodash, bitrefill, go, isDebug, txService, simService, gettextCatalog, txFormatService) {

    var configWallet = configService.getSync().wallet,
        currentFeeLevel = 'normal',
        fc = profileService.focusedClient,
        bitrefillConfig,
        self = this;

    window.ignoreMobilePause = true;
    $scope.isMainnet = (fc.credentials.network === 'livenet');
    $scope.isDebug = isDebug;
    $scope.isCordova = isCordova;

    storageService.getBitrefillConfig(function(err, bitrefillConfig) {
       self.bitrefillConfig = bitrefillConfig || {};
       $scope.amount = self.bitrefillConfig.amount;
       $scope.email = self.bitrefillConfig.email;
       $scope.phone = self.bitrefillConfig.phone || simService.getSimInfo().phoneNumber;
       $scope.package = self.bitrefillConfig.package;
    });

    var lookupNumber = $scope.lookupNumber = function() {
      $scope.error = $scope.btcValueStr = null;
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
            if ($scope.package) {
              $scope.updateBtcValue($scope.package.value, $scope.package.satoshiPrice);
            }
          } else {
            $scope.package = null;
            $scope.updateBtcValue($scope.amount);
          }
        }
      });
    };

    $scope.geoIpLookup = function(callback) {
      var lookedUp = false,
          defaultCountry = "US";
      $.getJSON('https://www.bitrefill.com/api/ipinfo', function(resp) {
        lookedUp = true;
        var countryCode = (resp && resp.country_code) ? resp.country_code : defaultCountry;
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

    $scope.pickContact = function() {
      if (!isCordova) return;
      navigator.contacts.pickContact(function(contact){
        setPhoneFromContact(contact);
      },function(err){
        handleError(err);
      });
    };

    var disableResumeListener = $rootScope.$on('Local/Resume', function(event) {
      if(event.pendingResult) {
        if(event.pendingResult.pluginStatus === "OK") {
          try {
            var contact = navigator.contacts.create(event.pendingResult.result);
            setPhoneFromContact(contact);
          } catch (e) {
            $log.error(e);
            $log.info(event.pendingResult.result);
          }
        } else {
          handleError(event.pendingResult.result);
        }
      }
    });

    $scope.$on('$destroy', function() {
        disableResumeListener();
    });

    var getContactMobilePhone = function(contact) {
      var mobiles = lodash.filter(contact.phoneNumbers, function(number) {
          return number.type == 'mobile' || number.type == 'work mobile';
      });
      $log.info(mobiles);
      var prefMobile = lodash.find(mobiles, function(number) {
          return number.pref;
      });
      $log.info(prefMobile);
      if (prefMobile) {
        return prefMobile.value;
      }

      if (mobiles.length > 0) {
          return mobiles[0].value;
      }

      var prefNumber = lodash.find(contact.phoneNumbers, function(number) {
          return number.pref;
      });
      $log.info(prefNumber);

      if (prefNumber) {
        return prefNumber.value;
      }

      return contact.phoneNumbers[0].value;
    };

    var setPhoneFromContact = function(contact) {
        if (!contact.phoneNumbers) return;
        $log.info(contact);
        $scope.phone = getContactMobilePhone(contact);
        $log.info($scope.phone);
        $timeout(function() {
          $rootScope.$apply();
        });
    };

    $scope.updateBtcValue = function(value, valueSat) {
      if (!value || (!valueSat && !$scope.selectedOp.range)) {
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
      var formattedPhone = $scope.orderForm.phone.formattedValue;

      addressService.getAddress(fc.credentials.walletId, null, function(err, refundAddress) {
        if (!refundAddress) {
          return handleError(bwsError.msg(err, 'Could not create address'));
        }

        self.setOngoingProcess(gettext('Creating order'));
        bitrefill.placeOrder($scope.phone, $scope.selectedOp.slug,
           $scope.amount || $scope.package.value, $scope.email, refundAddress, function(err, result) {

           if (err) {
             return handleError(err.message || err.error.message || err);
           }

           $log.debug(result);
           $scope.error = null;
           self.setOngoingProcess();

           var order = {
             operator: $scope.selectedOp,
             email: $scope.email,
             phone: formattedPhone,
             btcValueStr: profileService.formatAmount(result.satoshiPrice) + ' ' + configWallet.settings.unitName,
             altValueStr: txFormatService.formatAlternativeStr(result.satoshiPrice),
             amount: $scope.amount || $scope.package.value,
             currency: $scope.selectedOp.currency,
             orderId: result.orderId
           };

           self.showConfirmation(order, function(accept) {
             if (!accept) {
               return;
             }
             self.setOngoingProcess(gettext('Executing order'));
             var toAddress = isDebug ? "2N4FABwVoN4DMS1J4CDY9rPSyaVHVBcoUPw" : result.payment.address;
             var msg = 'Refill ' + formattedPhone +
                ' with '+ result.valuePackage + ' ' + $scope.selectedOp.currency;
             var txOpts = {
               toAddress: toAddress,
               amount: result.satoshiPrice,
               customData: JSON.stringify({
                 bitrefillOrderId: result.orderId
               }),
               outputs: [{
                'toAddress': toAddress,
                'amount': result.satoshiPrice,
                'message': msg
                }],
               message: msg
             };
             self.createAndSendTx(txOpts, function(err, result) {
               self.setOngoingProcess();
               self.bitrefillConfig.email = $scope.email;
               self.bitrefillConfig.amount = $scope.amount;
               self.bitrefillConfig.phone = $scope.phone;
               self.bitrefillConfig.package = $scope.package;

               if (err) {
                 storageService.setBitrefillConfig(self.bitrefillConfig, function() {});
                 return handleError(err);
               }
               storageService.setBitrefillConfig(self.bitrefillConfig, function() {
                  go.walletHome();
               });
             });
           });
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

      $timeout(function() {
        self.setOngoingProcess(gettext('Creating transaction'));
        txService.createTx(txOpts, function(err, txp) {
          self.setOngoingProcess();
          if (err) {
            return cb(bwsError.msg(err, 'Error'));
          }

          if (!fc.canSign() && !fc.isPrivKeyExternal()) {
            self.setOngoingProcess();
            $log.info('No signing proposal: No private key');
            refillStatus.notify(txp, function() {
              return $scope.$emit('Local/TxProposalAction');
            });
            return cb();
          } else {
            self.confirmTx(txp, cb);
          }
        });
      }, 100);
    };

    this.confirmTx = function(txp, cb) {
      var self = this;
      txService.prepare(function(err) {
        if (err) {
          return cb(bwsError.msg(err, 'Error'));
        }
        self.setOngoingProcess(gettextCatalog.getString('Sending transaction'));
        txService.publishTx(txp, function(err, txpPublished) {
          if (err) {
            return cb(bwsError.msg(err, 'Error'));
          } else {
            txService.signAndBroadcast(txpPublished, {
              reporterFn: self.setOngoingProcess.bind(self)
            }, function(err, txp) {
              if (err) {
                var errorMessage = err.message ? err.message : gettext('The payment was created but could not be completed. Please try again from home screen');
                $scope.$emit('Local/TxProposalAction');
                $timeout(function() {
                  $scope.$digest();
                }, 1);
                return cb(errorMessage);
              } else {
                refillStatus.notify(txp, function() {
                  $scope.$emit('Local/TxProposalAction');
                  return cb(null, { complete: true })
                });
              }
            });
          }
        });
      });
    };

    this.resetError = function() {
      $scope.error = null;
    };

    this.showConfirmation = function(order, cb) {
      $scope.confirmOrder = {
        order: order,
        callback: function(accept) {
          $scope.confirmOrder = null;
          return cb(accept);
        }
      };
      $timeout(function() {
        $rootScope.$apply();
      });
    };
});
