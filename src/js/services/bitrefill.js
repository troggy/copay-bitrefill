'use strict';

angular.module('copayAddon.bitrefill')
  .service('bitrefill', function($log, $http) {
    var root = {};
    
    var baseUrl = 'http://localhost:8000';
    
    var handleDataResponse = function(response, cb) {
      var data = response.data;
      if (data.error) {
        cb(data.error);
      } else if (data.errorMessage) {
        cb(data.errorMessage);
      } else {
        cb(null, data);
      }
    };
    
    var handleErrorResponse = function(response, cb) {
      $log.error('Bitrefill returned: ' + response.status + ': ' + response.data);
      cb(response.data);
    };
    
    var request = function(config, cb) {
      $http(config).then(function successCallback(response) {
        handleDataResponse(response, cb);
      }, function errorCallback(response) {
        handleErrorResponse(response, cb);
      });
    }
    
    root.inventory = function(cb) {
      var params = {
        method: 'GET',
        url: baseUrl + "/inventory/"
      };
      
      request(params, cb);
    };

    root.lookup_number = function(number, operator, cb) {
      if (typeof operator == 'function') {
        cb = operator;
        operator = null;
      }
      var params = {
        method: 'GET',
        url: baseUrl + "/lookup_number",
        params: {
          number: number,
          operatorSlug: operator || undefined
        }
      };
      
      request(params, cb);
    };

    root.place_order = function(number, operator, pack, email, cb) {
      var params = {
        method: "POST",
        url: baseUrl + "/order",
        data: {
          number: number,
          valuePackage: pack,
          operatorSlug: operator,
          email: email
        }
      };
      
      request(params, cb);
    };

    root.order_status = function(order_id, cb) {
      var params = {
        method: "GET",
        url: baseUrl + "/order/" + order_id
      };
      
      request(params, cb);
    };
    
    return root;
});