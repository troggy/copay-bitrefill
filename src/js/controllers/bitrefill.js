'use strict';

angular.module('copayAddon.bitrefill').controller('bitrefillController', 
  function($scope, $log, bitrefill2) {
    
    $scope.phone = null;
    
    $scope.lookupNumber = function() {
      bitrefill2.lookup_number($scope.phone, function(err, result) {
        if (err) {
            return;
        }
        console.log(result);
      })
    };

});
