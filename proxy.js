var fs = require('fs'),
    express = require('express'),
    bodyParser = require('body-parser');

var app = express();

app.use(bodyParser.json());
  
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "http://localhost:3000");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

var Bitrefill = require('bitrefill');

var bitrefill = Bitrefill({
  "key":'71O95FNWO433KELENKA1VL4FS',
  "secret":"Tombd6r5Ye2AAsLN6BmbQf6ttTIkobSsN4zpdifx6Vg",
  "url": "api.bitrefill.com/v1"
});

var forwardResponse = function(res) {
  return function(err, body) {
    if (err) {
      res.status(500).send(err).end();
    } else {
      res.status(200).send(body).end();
    }  
  };
};

app.get('/lookup_number', function(req, res) {
  bitrefill.lookup_number(req.query.number, req.query.operatorSlug, forwardResponse(res));
});

app.post('/order', function(req, res) {
  bitrefill.place_order(req.body.number, req.body.operatorSlug,
     req.body.valuePackage, req.body.email, forwardResponse(res));
});

app.get('/order/:orderId', function(req, res) {
  bitrefill.order_status(req.params.orderId, forwardResponse(res));
});

app.listen(8000);

console.log("Bitrefill API proxy is listening on port 8000");
