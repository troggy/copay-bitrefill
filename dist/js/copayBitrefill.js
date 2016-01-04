'use strict';

var module = angular.module('copayAddon.bitrefill', [
  'internationalPhoneNumber',
  'ngBitrefill',
  'copayBitrefill.views'
]);

module
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
           gettext, refillStatus, lodash, bitrefill, go) {
    
    var configWallet = configService.getSync().wallet,
        currentFeeLevel = configWallet.settings.feeLevel || 'normal',
        fc = profileService.focusedClient,
        self = this;
        
    $scope.phone = null;
    $scope.isMainnet = (fc.credentials.network === 'livenet');
    
    storageService.getBitrefillReceiptEmail(function(err, email) {
       $scope.email = email;
    });
    
    var lookupNumber = $scope.lookupNumber = function(operator) {
      $scope.error = null;
      $scope.amount = null;
      $scope.btcValueStr = null;
      $scope.package = null;
      self.setOngoingProcess(gettext('Looking up operator'));
      bitrefill.lookupNumber($scope.phone, operator, function(err, result) {
        self.setOngoingProcess();
        if (err) {
            return handleError(err.message || err.error || err);
        }
        $log.debug(result);
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
             if (err) {
               return handleError(err);
             }
             storageService.setBitrefillReceiptEmail($scope.email, function() {
                go.walletHome();
             });
           })
         });
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
      var result = { status: 'status', data: data, msg: msg };
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
    
    return {
      subscribe: subscribe
    };
});

'use strict';

angular.module('copayAddon.bitrefill').factory('refillStatus',
 function($modal, lodash, profileService, $timeout, txFormatService, isCordova) {
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
    var ModalInstanceCtrl = function($scope, $log, $timeout, $modalInstance, bitrefill, pusher) {
      $scope.type = type;
      $scope.tx = txFormatService.processTx(txp);
      $scope.color = fc.backgroundColor;
      if (isCordova && StatusBar.isVisible) {
        StatusBar.hide();
      }
      
      var orderId = txp.customData.bitrefillOrderId,
          paymentAddress = txp.toAddress;
      
      pusher.subscribe(orderId, paymentAddress, function(orderStatus) {
        $scope.orderStatus = orderStatus;
      });
      
      $scope.cancel = function() {
        $modalInstance.dismiss('cancel');
      };
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
      var m = angular.element(document.getElementsByClassName('reveal-modal'));
      m.addClass('hideModal');
    });
  };

  return root;
});

angular.module('copayBitrefill.views', ['bitrefill/views/bitrefill.html', 'bitrefill/views/modals/operators.html', 'bitrefill/views/modals/refill-status.html']);

angular.module("bitrefill/views/bitrefill.html", []).run(["$templateCache", function($templateCache) {
  $templateCache.put("bitrefill/views/bitrefill.html",
    "<div \n" +
    "  class=\"topbar-container\" \n" +
    "  ng-include=\"'views/includes/topbar.html'\"\n" +
    "  ng-init=\"titleSection='Top up mobile phone'; goBackToState = 'walletHome';\">\n" +
    "</div>\n" +
    "\n" +
    "\n" +
    "<div class=\"content bitrefill\" ng-controller=\"bitrefillController as bitrefill\">\n" +
    "    <div class=\"bitrefill--logo\">\n" +
    "      <img src=\"img/bitrefill-logo.png\" width=\"200\">\n" +
    "    </div>\n" +
    "    \n" +
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
    "    \n" +
    "    <div class=\"box-notification m20t\" ng-show=\"error\" ng-click=\"resetError()\">\n" +
    "      <span class=\"text-warning\">\n" +
    "        {{ error|translate }}\n" +
    "      </span>\n" +
    "    </div>\n" +
    "    \n" +
    "    <div class=\"m20t\" ng-hide=\"isMainnet\">\n" +
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
    "\n" +
    "    <form name=\"orderForm\" ng-show=\"isMainnet\">\n" +
    "    \n" +
    "    <div class=\"large-12 columns m20t\" >\n" +
    "      <div class=\"bitrefill--order-field\">\n" +
    "        <div class=\"row collapse\">\n" +
    "          <label for=\"phone\" class=\"left\" >\n" +
    "            <span translate>Phone number to refill</span>\n" +
    "          </label>\n" +
    "          <span ng-hide=\"orderForm.phone.$pristine\">\n" +
    "            <span class=\"has-error right size-12\" ng-show=\"orderForm.phone.$invalid\">\n" +
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
    "               ng-disabled=\"selectedOp\"\n" +
    "               geo-ip-lookup=\"geoIpLookup\"\n" +
    "               skip-util-script-download international-phone-number>\n" +
    "        </div>\n" +
    "      </div>\n" +
    "      \n" +
    "      <div class=\"m20t\" ng-hide=\"selectedOp\">\n" +
    "        <button class=\"button black round expand\" ng-click=\"lookupNumber()\"\n" +
    "          ng-disabled=\"loading || !phone\" translate>\n" +
    "          Continue\n" +
    "        </button>\n" +
    "      </div>\n" +
    "      \n" +
    "      <div ng-show=\"selectedOp\" class=\"m10t bitrefill--order-field\">\n" +
    "          <div class=\"row collapse\">\n" +
    "            <label for=\"operator\" class=\"left\" >\n" +
    "              <span translate>Operator</span>\n" +
    "            </label>\n" +
    "          </div>\n" +
    "          <div class=\"bitrefill--selectedOp\" ng-click=\"openOperatorsModal(operators, selectedOp)\">\n" +
    "            <div class=\"right text-gray\">\n" +
    "              <i class=\"icon-arrow-right3 size-24\"></i>\n" +
    "            </div>\n" +
    "            <div class=\"bitrefill--operator-item\">\n" +
    "              <img src=\"{{ selectedOp.logoImage }}\"/>\n" +
    "              <span class=\"bitrefill--operator-name\">{{ selectedOp.name }}</span>\n" +
    "            </div>\n" +
    "          </div>\n" +
    "      </div>\n" +
    "      \n" +
    "      <div ng-show=\"selectedOp && !selectedOp.isRanged\" class=\"m10t\">\n" +
    "          <label><span translate>Amount</span>\n" +
    "            <select class=\"m10t\" ng-model=\"package\"\n" +
    "              ng-options=\"package as package.valueStr for package in packages\"\n" +
    "              ng-change=\"updateBtcValue(package.value, package.satoshiPrice)\" required>\n" +
    "              <option value=\"\">Select package...</option>\n" +
    "            </select>\n" +
    "          </label>\n" +
    "      </div>\n" +
    "      \n" +
    "      <div ng-show=\"selectedOp && selectedOp.isRanged\" class=\"m10t bitrefill--order-field\">\n" +
    "        <div class=\"row collapse\">\n" +
    "          <label for=\"amount\" class=\"left\" >\n" +
    "            <span translate>Amount</span>\n" +
    "            <small translate>From {{selectedOp.range.min}} to {{selectedOp.range.max}} {{selectedOp.currency}}</small>\n" +
    "          </label>\n" +
    "          <span ng-hide=\"orderForm.amount.$pristine\">\n" +
    "            <span class=\"has-error right size-12\" ng-show=\"orderForm.amount.$invalid\">\n" +
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
    "                 ng-attr-placeholder=\"{{'Amount in'}} {{selectedOp.currency}}\"\n" +
    "                 min=\"{{selectedOp.range.min}}\"\n" +
    "                 max=\"{{selectedOp.range.max}}\"\n" +
    "                 step=\"{{selectedOp.range.step}}\"\n" +
    "                 ng-change=\"updateBtcValue(amount)\"\n" +
    "                 name=\"amount\" ng-model=\"amount\" required>\n" +
    "        </div>\n" +
    "      </div>\n" +
    "      \n" +
    "      <div ng-show=\"selectedOp\" class=\"m10t bitrefill--order-field\">\n" +
    "        <div class=\"row collapse\">\n" +
    "          <label for=\"email\" class=\"left\" >\n" +
    "            <span translate>Email</span>\n" +
    "            <small translate>Receipt will be sent to this email</small>\n" +
    "          </label>\n" +
    "          <span ng-show=\"orderForm.email.$dirty\">\n" +
    "            <span class=\"has-error right size-12\" ng-show=\"orderForm.email.$invalid\">\n" +
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
    "                 name=\"email\" ng-model=\"email\" required>\n" +
    "        </div>\n" +
    "      </div>\n" +
    "      \n" +
    "      <div ng-show=\"btcValueStr\" class=\"bitrefill--btc-value\"><span translate>You will pay</span> <strong>{{ btcValueStr }}</strong></div>\n" +
    "      \n" +
    "      <div class=\"columns\" ng-show=\"selectedOp\">\n" +
    "        <button class=\"button black round expand\" ng-disabled=\"!isValid() || loading\" \n" +
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

angular.module("bitrefill/views/modals/operators.html", []).run(["$templateCache", function($templateCache) {
  $templateCache.put("bitrefill/views/modals/operators.html",
    "<nav class=\"tab-bar\" ng-style=\"{'background-color':color}\">\n" +
    "  <section class=\"left-small\">\n" +
    "    <a ng-click=\"cancel()\">\n" +
    "      <i class=\"icon-arrow-left3 icon-back\"></i>\n" +
    "      <span class=\"text-back\" translate>Back</span>\n" +
    "    </a>\n" +
    "  </section>\n" +
    "  <section class=\"middle tab-bar-section\">\n" +
    "    <h1 class=\"title ellipsis\" translate>\n" +
    "      Select operator\n" +
    "    </h1>\n" +
    "  </section>\n" +
    "</nav>\n" +
    "<div class=\"modal-content fix-modals-touch\" \n" +
    "     ng-swipe-disable-mouse\n" +
    "     ng-swipe-right=\"cancel()\">\n" +
    "\n" +
    "   <ul class=\"no-bullet m0 bitrefill--operator-list\">\n" +
    "     <li ng-repeat=\"op in operators | orderBy: name\" class=\"bitrefill--operator-item\" \n" +
    "         ng-click=\"selectOperator(op.slug)\">\n" +
    "       <img ng-src=\"{{ op.logoImage }}\"/>\n" +
    "       <span class=\"bitrefill--operator-name\">{{ op.name }}</span>\n" +
    "       <i class=\"fi-check size-16 right\" ng-show=\"selectedOp.slug == op.slug\"></i>\n" +
    "     </li>\n" +
    "   </ul>\n" +
    "\n" +
    "  <div class=\"extra-margin-bottom\"></div>\n" +
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
    "    <div class=\"m10t\" translate>{{ orderStatus.data.pinInfo.instructions }}</div>\n" +
    "    <div class=\"m10t\"><span translate>Your PIN code</span>:</div>\n" +
    "    <div class=\"bitrefill--pin-code\" translate>{{ orderStatus.data.pinInfo.pin }}</div>\n" +
    "    <small translate>{{ orderStatus.data.pinInfo.other}}</small>\n" +
    "  </div>\n" +
    "  \n" +
    "  <div class=\"size-16 text-gray\" ng-show=\"orderStatus.delivered && !orderStatus.data.pinInfo\" translate>\n" +
    "    {{ tx.customData.description }}\n" +
    "  </div>\n" +
    "\n" +
    "  <div class=\"size-16 text-gray\" ng-show=\"orderStatus.failed || orderStatus.partial\" translate>\n" +
    "    {{ orderStatus.msg || 'Failed to process order' }}\n" +
    "  </div>\n" +
    "\n" +
    "  <div class=\"size-16 text-gray\" ng-show=\"!orderStatus || orderStatus.paid || orderStatus.confirmed\">\n" +
    "    <div translate>Payment sent</div>\n" +
    "    <div translate>{{ tx.customData.description }}</div>\n" +
    "  </div>\n" +
    "  \n" +
    "  <div class=\"text-center m20t\">\n" +
    "    <a class=\"button outline round light-gray tiny small-4\" ng-click=\"cancel()\">OKAY</a>\n" +
    "  </div>\n" +
    "  <a ng-click=\"toggleStatus()\">next</a>\n" +
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
