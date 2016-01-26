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
    
    return {
      subscribe: subscribe
    };
});
