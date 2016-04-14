'use strict';

var bitrefillModule = angular.module('copayAddon.bitrefill', [
  'internationalPhoneNumber',
  'ngBitrefill',
  'copayBitrefill.views'
]);

bitrefillModule
    .config(function (bitrefillProvider, $stateProvider) {
      
      bitrefillProvider.setCredentials(
        '71O95FNWO433KELENKA1VL4FS',
        'Tombd6r5Ye2AAsLN6BmbQf6ttTIkobSsN4zpdifx6Vg'
      );
      
      $stateProvider.state('bitrefill', {
        url: '/bitrefill',
        walletShouldBeComplete: true,
        needProfile: true,
        views: {
          'main': {
            templateUrl: 'bitrefill/views/bitrefill.html'
          },
        }
      })
    })
    .run(function (addonManager, $state) {

    });
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

'use strict';

angular.module('copayAddon.bitrefill').service('pusher',
  function($log) {
    Pusher.log = function(message) {
      $log.debug(message);
    };

    var pusher = new Pusher('0837b617cfe786c32a91', {
      encrypted: true
    });

    var callback = function(status, data, msg, cb) {
      var result = { status: status, data: data, msg: msg };
      result[status] = true;
      cb(result);
    };

    var subscribe = function(orderId, paymentAddress, cb) {
      var channelName = [orderId, paymentAddress].join('-'),
          channel = pusher.subscribe(channelName);

      channel.bind('paid', function(data) {
        callback('paid', data, null, cb);
      });
      channel.bind('confirmed', function(data) {
        callback('confirmed', data, null, cb);
      });
      channel.bind('partial', function(data) {
        callback('partial', data, null, cb);
      });
      channel.bind('delivered', function(data) {
        pusher.unsubscribe(channelName);
        callback('delivered', data, null, cb);
      });
      channel.bind('failed', function(data, msg) {
        pusher.unsubscribe(channelName);
        callback('failed', data, msg, cb);
      });
    };

    var unsubscribe = function(orderId, paymentAddress) {
      var channelName = [orderId, paymentAddress].join('-');
      pusher.unsubscribe(channelName);
    };

    return {
      subscribe: subscribe,
      unsubscribe: unsubscribe
    };
});

'use strict';

angular.module('copayAddon.bitrefill').factory('refillStatus',
 function($modal, lodash, profileService, isCordova, $rootScope) {
  var root = {};

  root.notify = function(txp, cb) {
    var fc = profileService.focusedClient;
    var status = txp.status;
    var type;
    var INMEDIATE_SECS = 10;

    if (status == 'broadcasted') {
      type = 'broadcasted';
    } else {

      var n = txp.actions.length;
      var action = lodash.find(txp.actions, {
        copayerId: fc.credentials.copayerId
      });

      if (!action)  {
        type = 'created';
      } else if (action.type == 'accept') {
        // created and accepted at the same time?
        if ( n == 1 && action.createdOn - txp.createdOn < INMEDIATE_SECS ) {
          type = 'created';
        } else {
          type = 'accepted';
        }
      } else if (action.type == 'reject') {
        type = 'rejected';
      } else {
        throw new Error('Unknown type:' + type);
      }
    }

    openModal(type, txp, cb);
  };

  root._templateUrl = function(type, txp) {
    return 'bitrefill/views/modals/refill-status.html';
  };

  var openModal = function(type, txp, cb) {
    var fc = profileService.focusedClient;
    var ModalInstanceCtrl = function($scope, $log, $timeout, $modalInstance, bwcService, bitrefill, pusher, txFormatService) {
      $scope.type = type;
      $scope.tx = txFormatService.processTx(txp);
      $scope.color = fc.backgroundColor;
      if (isCordova && StatusBar.isVisible) {
        StatusBar.hide();
      }

      txp.customData = JSON.parse(txp.customData);
      var orderId = txp.customData.bitrefillOrderId,
          paymentAddress = txp.toAddress;

      try {
        txp.message = bwcService.getUtils().decryptMessage(txp.message, fc.credentials.sharedEncryptingKey);
      } catch (e) {
        // assume message is not encrypted
      }

      pusher.subscribe(orderId, paymentAddress, function(orderStatus) {
        $scope.orderStatus = orderStatus;
        $timeout(function() {
          $scope.$digest();
        }, 1);
      });

      $scope.cancel = function() {
        $modalInstance.dismiss('cancel');
      };

      $rootScope.$on('Local/PusherUnsubscribe', function() {
        pusher.unsubscribe(orderId, paymentAddress);
      });
      if (cb) $timeout(cb, 100);
    };
    var modalInstance = $modal.open({
      templateUrl: root._templateUrl(type, txp),
      windowClass: 'popup-tx-status full',
      controller: ModalInstanceCtrl,
    });

    modalInstance.result.finally(function() {
      if (isCordova && !StatusBar.isVisible) {
        StatusBar.show();
      }
      $rootScope.$emit('Local/PusherUnsubscribe');
      var m = angular.element(document.getElementsByClassName('reveal-modal'));
      m.addClass('hideModal');
    });
  };

  return root;
});

'use strict';

angular.module('copayAddon.bitrefill').service('simService', function ($log) {
  var simInfo = {};
  
  if (window.cordova && window.plugins && window.plugins.sim) {
    window.plugins.sim.getSimInfo(function(_simInfo) {
      $log.info("SIM card info: " + JSON.stringify(_simInfo));
      simInfo = _simInfo;
    }, function(error) {
      $log.warn("Unable to retrieve SIM info: " + error);
    });
  }
  
  this.getSimInfo = function() {
      return simInfo;
  };
});

angular.module('copayBitrefill.views', ['bitrefill/views/bitrefill.html', 'bitrefill/views/includes/confirm-tx.html', 'bitrefill/views/modals/refill-status.html']);

angular.module("bitrefill/views/bitrefill.html", []).run(["$templateCache", function($templateCache) {
  $templateCache.put("bitrefill/views/bitrefill.html",
    "<div\n" +
    "  class=\"topbar-container\"\n" +
    "  ng-include=\"'views/includes/topbar.html'\"\n" +
    "  ng-init=\"titleSection='Top up mobile phone'; goBackToState = 'walletHome';\">\n" +
    "</div>\n" +
    "\n" +
    "\n" +
    "<div class=\"content bitrefill\" ng-controller=\"bitrefillController as bitrefill\">\n" +
    "    <div ng-include=\"'bitrefill/views/includes/confirm-tx.html'\" ng-if=\"confirmOrder\"></div>\n" +
    "    <div class=\"bitrefill--logo\">\n" +
    "      <img src=\"img/bitrefill-logo.png\" width=\"200\">\n" +
    "    </div>\n" +
    "\n" +
    "    <div class=\"onGoingProcess\" ng-show=\"loading\">\n" +
    "      <div class=\"onGoingProcess-content\" ng-style=\"{'background-color':index.backgroundColor}\">\n" +
    "        <div class=\"spinner\">\n" +
    "          <div class=\"rect1\"></div>\n" +
    "          <div class=\"rect2\"></div>\n" +
    "          <div class=\"rect3\"></div>\n" +
    "          <div class=\"rect4\"></div>\n" +
    "          <div class=\"rect5\"></div>\n" +
    "        </div>\n" +
    "        {{ loading|translate }}...\n" +
    "      </div>\n" +
    "    </div>\n" +
    "\n" +
    "    <div class=\"box-notification m20t\" ng-show=\"error\" ng-click=\"resetError()\">\n" +
    "      <span class=\"text-warning\">\n" +
    "        {{ error|translate }}\n" +
    "      </span>\n" +
    "    </div>\n" +
    "\n" +
    "    <div class=\"m20t\" ng-hide=\"isMainnet || isDebug\">\n" +
    "      <div class=\"text-center text-warning\">\n" +
    "        <i class=\"fi-alert\"></i>\n" +
    "        <span translate>\n" +
    "          You are using testnet wallet\n" +
    "        </span>\n" +
    "      </div>\n" +
    "      <div class=\"text-center text-gray m15r m15l\" translate>\n" +
    "        To proceed with refill switch to mainnet wallet and try again\n" +
    "      </div>\n" +
    "      <div class=\"text-center m10t \">\n" +
    "        <span class=\"button outline round dark-gray tiny\"\n" +
    "          ng-click=\"openWalletsList()\">\n" +
    "          <span translate>Change wallet</span>\n" +
    "        </span>\n" +
    "      </div>\n" +
    "    </div>\n" +
    "\n" +
    "    <form name=\"orderForm\" ng-show=\"isMainnet || isDebug\">\n" +
    "\n" +
    "    <div class=\"large-12 columns m20t\" >\n" +
    "      <div class=\"bitrefill--order-field\">\n" +
    "        <div class=\"row collapse\">\n" +
    "          <label for=\"phone\" class=\"left\" >\n" +
    "            <span translate>Phone number to refill</span>\n" +
    "          </label>\n" +
    "          <span>\n" +
    "            <span class=\"has-error right size-12\" ng-show=\"orderForm.phone.$dirty && orderForm.phone.$invalid\">\n" +
    "              <i class=\"icon-close-circle size-14\"></i>\n" +
    "              <span class=\"vm\" translate>Not valid</span>\n" +
    "            </span>\n" +
    "            <small class=\"right text-primary\" ng-show=\"!orderForm.phone.$invalid\">\n" +
    "              <i class=\"icon-checkmark-circle size-14\"></i>\n" +
    "            </small>\n" +
    "          </span>\n" +
    "        </div>\n" +
    "\n" +
    "        <div class=\"input\">\n" +
    "          <input class=\"m0\" type=\"text\" id=\"phone\" name=\"phone\"\n" +
    "               minLength=\"4\" ng-model=\"phone\" initial-country=\"auto\" required\n" +
    "               ng-disabled=\"operators || loading\"\n" +
    "               geo-ip-lookup=\"geoIpLookup\"\n" +
    "               skip-util-script-download international-phone-number>\n" +
    "           <a class=\"postfix size-12 m0 text-gray\"\n" +
    "                ng-show=\"isCordova\"\n" +
    "                ng-style=\"{'color':index.backgroundColor}\"\n" +
    "                ng-click=\"pickContact()\">\n" +
    "                <i class=\"icon-contact text-bold size-24\"></i>\n" +
    "           </a>\n" +
    "        </div>\n" +
    "      </div>\n" +
    "\n" +
    "      <div class=\"m20t\" ng-hide=\"operators\">\n" +
    "        <button class=\"button black round expand\" ng-click=\"lookupNumber()\"\n" +
    "          ng-disabled=\"loading || !phone\" translate>\n" +
    "          Continue\n" +
    "        </button>\n" +
    "      </div>\n" +
    "\n" +
    "      <div ng-show=\"operators\" class=\"m10t bitrefill--order-field\">\n" +
    "          <div class=\"row collapse\">\n" +
    "            <label for=\"operator\" class=\"left\" >\n" +
    "              <span translate>Operator</span>\n" +
    "            </label>\n" +
    "            <span>\n" +
    "              <span class=\"has-error right size-12\" ng-show=\"!selectedOp\">\n" +
    "                <i class=\"icon-close-circle size-14\"></i>\n" +
    "                <span class=\"vm\" translate>Not valid</span>\n" +
    "              </span>\n" +
    "              <small class=\"right text-primary\" ng-show=\"selectedOp\">\n" +
    "                <i class=\"icon-checkmark-circle size-14\"></i>\n" +
    "              </small>\n" +
    "            </span>\n" +
    "          </div>\n" +
    "          <div class=\"input\">\n" +
    "            <select ng-model=\"selectedOp\"\n" +
    "              ng-options=\"operator as operator.name for operator in operators track by operator.slug\"\n" +
    "              ng-disabled=\"loading\"\n" +
    "              ng-change=\"lookupNumber()\" required>\n" +
    "              <option value=\"\">Select operator...</option>\n" +
    "            </select>\n" +
    "          </div>\n" +
    "      </div>\n" +
    "\n" +
    "      <div ng-show=\"selectedOp && !selectedOp.isRanged\" class=\"m10t bitrefill--order-field\">\n" +
    "        <div class=\"row collapse\">\n" +
    "          <label for=\"amount\" class=\"left\" >\n" +
    "            <span translate>Amount</span>\n" +
    "          </label>\n" +
    "          <span>\n" +
    "            <small class=\"right text-primary\" ng-show=\"package\">\n" +
    "              <i class=\"icon-checkmark-circle size-14\"></i>\n" +
    "            </small>\n" +
    "          </span>\n" +
    "        </div>\n" +
    "        <div class=\"input\">\n" +
    "          <select ng-model=\"package\"\n" +
    "            ng-options=\"package as package.valueStr for package in packages track by package.value\"\n" +
    "            ng-disabled=\"loading\"\n" +
    "            ng-change=\"updateBtcValue(package.value, package.satoshiPrice)\" required>\n" +
    "            <option value=\"\">Select package...</option>\n" +
    "          </select>\n" +
    "        </div>\n" +
    "      </div>\n" +
    "\n" +
    "      <div ng-show=\"(selectedOp && selectedOp.isRanged) || (operators && !selectedOp)\" class=\"m10t bitrefill--order-field\">\n" +
    "        <div class=\"row collapse\">\n" +
    "          <label for=\"amount\" class=\"left\" >\n" +
    "            <span translate>Amount</span>\n" +
    "            <small ng-show=\"selectedOp\" translate>From {{selectedOp.range.min}} to {{selectedOp.range.max}} {{selectedOp.currency}}</small>\n" +
    "          </label>\n" +
    "          <span>\n" +
    "            <span class=\"has-error right size-12\" ng-show=\"orderForm.amount.$dirty && orderForm.amount.$invalid\">\n" +
    "              <i class=\"icon-close-circle size-14\"></i>\n" +
    "              <span class=\"vm\" translate>Not valid</span>\n" +
    "            </span>\n" +
    "            <small class=\"right text-primary\" ng-show=\"!orderForm.amount.$invalid\">\n" +
    "              <i class=\"icon-checkmark-circle size-14\"></i>\n" +
    "            </small>\n" +
    "          </span>\n" +
    "        </div>\n" +
    "        <div class=\"input\">\n" +
    "          <input class=\"m0\" type=\"number\" id=\"amount\"\n" +
    "                 ng-attr-placeholder=\"{{selectedOp.currency}} {{'amount'}}\"\n" +
    "                 min=\"{{selectedOp.range.min}}\"\n" +
    "                 max=\"{{selectedOp.range.max}}\"\n" +
    "                 step=\"{{selectedOp.range.step}}\"\n" +
    "                 ng-change=\"updateBtcValue(amount)\"\n" +
    "                 ng-disabled=\"loading\"\n" +
    "                 name=\"amount\" ng-model=\"amount\" required>\n" +
    "        </div>\n" +
    "      </div>\n" +
    "\n" +
    "      <div ng-show=\"operators\" class=\"m10t bitrefill--order-field\">\n" +
    "        <div class=\"row collapse\">\n" +
    "          <label for=\"email\" class=\"left\" >\n" +
    "            <span translate>Email</span>\n" +
    "            <small translate>Receipt will be sent to this email</small>\n" +
    "          </label>\n" +
    "          <span>\n" +
    "            <span class=\"has-error right size-12\" ng-show=\"orderForm.email.$dirty && orderForm.email.$invalid\">\n" +
    "              <i class=\"icon-close-circle size-14\"></i>\n" +
    "              <span class=\"vm\" translate>Not valid</span>\n" +
    "            </span>\n" +
    "            <small class=\"right text-primary\" ng-show=\"!orderForm.email.$invalid\">\n" +
    "              <i class=\"icon-checkmark-circle size-14\"></i>\n" +
    "            </small>\n" +
    "          </span>\n" +
    "        </div>\n" +
    "        <div class=\"input\">\n" +
    "          <input class=\"m0\" type=\"email\" id=\"email\" ng-attr-placeholder=\"{{'Email address'}}\"\n" +
    "                 ng-disabled=\"loading\"\n" +
    "                 name=\"email\" ng-model=\"email\" required>\n" +
    "        </div>\n" +
    "      </div>\n" +
    "\n" +
    "      <div ng-show=\"btcValueStr\" class=\"bitrefill--btc-value\"><span translate>You will pay</span> <strong>{{ btcValueStr }}</strong></div>\n" +
    "\n" +
    "      <div class=\"columns\" ng-show=\"operators\">\n" +
    "        <button class=\"button black round expand\" ng-disabled=\"!isValid() || loading\"\n" +
    "                ng-click=\"placeOrder()\" translate>\n" +
    "          Place order\n" +
    "        </button>\n" +
    "      </div>\n" +
    "    </form>\n" +
    "\n" +
    "    </div>\n" +
    "\n" +
    "</div> <!--/content-->\n" +
    "<script src=\"//js.pusher.com/3.0/pusher.min.js\"></script>\n" +
    "");
}]);

angular.module("bitrefill/views/includes/confirm-tx.html", []).run(["$templateCache", function($templateCache) {
  $templateCache.put("bitrefill/views/includes/confirm-tx.html",
    "<div class=\"modalMask\"></div>\n" +
    "\n" +
    "<div class=\"confirmTxModal\" ng-init=\"order = confirmOrder.order\">\n" +
    "\n" +
    "  <div class=\"confirmHead\" ng-style=\"{'background-color':index.backgroundColor}\">\n" +
    "    <h1 class=\"m0 text-center text-white size-18\" translate>Confirm order</h1>\n" +
    "  </div>\n" +
    "  <div class=\"p10\">\n" +
    "    <div class=\"bitrefill--confirm-logo text-center small-centered columns m10t m10b\" ng-style=\"{'color':color, 'border-color':color}\">\n" +
    "      <img ng-src=\"{{order.operator.logoImage}}\">\n" +
    "    </div>\n" +
    "    <div class=\"size-24\">{{ order.operator.name }} {{ order.amount }} {{ order.currency }}</div>\n" +
    "    <i class=\"db fi-arrow-down size-24 m10v\"></i>\n" +
    "    <div class=\"payment-proposal-to\">\n" +
    "      <contact class=\"dib enable_text_select ellipsis m5t m5b m15l size-14\" address=\"{{ order.phone }}\"></contact>\n" +
    "    </div>\n" +
    "    <div class=\"m10t size-12\">\n" +
    "      <span translate>Price</span>:\n" +
    "      <span class=\"text-bold\">{{ order.btcValueStr }}</span>\n" +
    "      <span class=\"label gray radius\">{{ order.altValueStr }}</span>\n" +
    "    </div>\n" +
    "    <div class=\"m10t size-12\">\n" +
    "      <span translate>Order ID</span>:\n" +
    "      <span class=\"text-bold\">{{ order.orderId }}</span>\n" +
    "    </div>\n" +
    "    <div class=\"m10t size-12\">\n" +
    "      <span translate>Email</span>:\n" +
    "      <span class=\"text-bold\">{{ order.email }}</span>\n" +
    "    </div>\n" +
    "\n" +
    "    <div class=\"row m20t\">\n" +
    "      <div class=\"large-6 medium-6 small-6 columns\">\n" +
    "        <button\n" +
    "           ng-click=\"confirmOrder.callback()\"\n" +
    "           class=\"small m10b round outline dark-gray expand\" translate>\n" +
    "          Cancel\n" +
    "        </button>\n" +
    "      </div>\n" +
    "      <div class=\"large-6 medium-6 small-6 columns\">\n" +
    "        <button\n" +
    "           ng-click=\"confirmOrder.callback(true)\"\n" +
    "           class=\"small m10b round expand\"\n" +
    "           ng-style=\"{'background-color':index.backgroundColor}\" translate>\n" +
    "          Confirm\n" +
    "        </button>\n" +
    "      </div>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "</div>\n" +
    "");
}]);

angular.module("bitrefill/views/modals/refill-status.html", []).run(["$templateCache", function($templateCache) {
  $templateCache.put("bitrefill/views/modals/refill-status.html",
    "<div ng-if=\"type == 'broadcasted'\" class=\"popup-txsent text-center\">\n" +
    "  <i class=\"small-centered columns m20tp\" \n" +
    "    ng-class=\"{\n" +
    "      'fi-clock': !orderStatus || orderStatus.paid || orderStatus.confirmed,\n" +
    "      'fi-check': orderStatus.delivered,\n" +
    "      'fi-thumbnails': orderStatus.data.pinInfo,\n" +
    "      'fi-x': orderStatus.failed || orderStatus.partial\n" +
    "      }\"\n" +
    "    ng-style=\"{'color':color, 'border-color':color}\"></i>\n" +
    "  <div ng-show=\"!orderStatus || orderStatus.paid || orderStatus.confirmed\" class=\"m20t size-24 text-white\">\n" +
    "    Waiting for order to complete..\n" +
    "  </div>\n" +
    "  <div ng-show=\"orderStatus.data.pinInfo\" class=\"m20t size-24 text-white\">\n" +
    "    PIN required\n" +
    "  </div>\n" +
    "  \n" +
    "  <div ng-show=\"orderStatus.delivered && !orderStatus.data.pinInfo\" class=\"m20t size-24 text-white\">\n" +
    "    Delivered\n" +
    "  </div>\n" +
    "  <div ng-show=\"orderStatus.failed || orderStatus.partial\" class=\"m20t size-24 text-white\">\n" +
    "    Failed\n" +
    "  </div>\n" +
    "  \n" +
    "  <div class=\"size-16 text-gray\" ng-show=\"orderStatus.data.pinInfo\">\n" +
    "    <div class=\"m10t enable_text_select\" translate>{{ orderStatus.data.pinInfo.instructions }}</div>\n" +
    "    <div class=\"m10t\"><span translate>Your PIN code</span>:</div>\n" +
    "    <div class=\"bitrefill--pin-code enable_text_select\" translate>{{ orderStatus.data.pinInfo.pin }}</div>\n" +
    "    <small translate>{{ orderStatus.data.pinInfo.other}}</small>\n" +
    "  </div>\n" +
    "  \n" +
    "  <div class=\"size-16 text-gray\" ng-show=\"orderStatus.delivered && !orderStatus.data.pinInfo\" translate>\n" +
    "    <div>{{ tx.message }}</div>\n" +
    "    <small translate>Order ID: <span class=\"enable_text_select\">{{ tx.customData.bitrefillOrderId}}</span></small>\n" +
    "  </div>\n" +
    "\n" +
    "  <div class=\"size-16 text-gray\" ng-show=\"orderStatus.failed || orderStatus.partial\" translate>\n" +
    "    {{ orderStatus.msg || 'Failed to process order' }}\n" +
    "  </div>\n" +
    "\n" +
    "  <div class=\"size-16 text-gray\" ng-show=\"!orderStatus || orderStatus.paid || orderStatus.confirmed\">\n" +
    "    <div translate>Payment sent</div>\n" +
    "    <div translate>{{ tx.message }}</div>\n" +
    "    <small translate>Order ID: <span class=\"enable_text_select\">{{ tx.customData.bitrefillOrderId}}</span></small>\n" +
    "  </div>\n" +
    "  \n" +
    "  <div class=\"text-center m20t\">\n" +
    "    <a class=\"button outline round light-gray tiny small-4\" ng-click=\"cancel()\">OKAY</a>\n" +
    "  </div>\n" +
    "</div>\n" +
    "\n" +
    "\n" +
    "<div ng-if=\"type == 'created'\" class=\"popup-txsigned\">\n" +
    "  <i class=\"small-centered columns fi-check m30tp\" ng-style=\"{'color':color, 'border-color':color}\"></i>\n" +
    "  <div class=\"text-center size-18 tu text-bold p20\" ng-style=\"{'color':color}\">\n" +
    "    <span translate>Payment Proposal Created</span>\n" +
    "  </div>\n" +
    "  <div class=\"text-center\">\n" +
    "    <a class=\"button outline round light-gray tiny small-4\" ng-click=\"cancel()\">OKAY</a>\n" +
    "  </div>\n" +
    "</div>\n" +
    "\n" +
    "\n" +
    "\n" +
    "<div ng-if=\"type == 'accepted'\" class=\"popup-txsigned\">\n" +
    "  <i class=\"small-centered columns fi-check m30tp\" ng-style=\"{'color':color, 'border-color':color}\"></i>\n" +
    "  <div class=\"text-center size-18 text-primary tu text-bold p20\" ng-style=\"{'color':color}\">\n" +
    "    <span translate>Payment Accepted</span>\n" +
    "  </div>\n" +
    "  <div class=\"text-center\">\n" +
    "    <a class=\"button outline round light-gray tiny small-4\" ng-click=\"cancel()\">OKAY</a>\n" +
    "  </div>\n" +
    "</div>\n" +
    "\n" +
    "<div ng-if=\"type=='rejected'\" class=\"popup-txrejected\">\n" +
    "  <i class=\"fi-x small-centered columns m30tp\" ng-style=\"{'color':color, 'border-color':color}\"></i>\n" +
    "  <div class=\"text-center size-18 tu text-bold p20\" ng-style=\"{'color':color}\">\n" +
    "    <span translate>Payment Rejected</span>\n" +
    "  </div>\n" +
    "  <div class=\"text-center\">\n" +
    "    <a class=\"button outline light-gray round tiny small-4\" ng-click=\"cancel()\">OKAY</a>\n" +
    "  </div>\n" +
    "</div>\n" +
    "");
}]);
