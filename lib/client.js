var zlib = require('zlib'),
    utils = require('./utils'),
    parseUrl = require('url').parse,
    uuid = require('node-uuid'),
    http = {http: require('http'), https: require('https')};

var Client = function Client(dsn, options) {
    options = options || {};
    this.dsn = utils.parseDSN(dsn);
    this.name = options.name || require('os').hostname();
    this.site = options.site;
    this.root = options.root || process.cwd();
}, _ = Client.prototype;

module.exports.Client = Client;

_.getIdent =
_.get_ident = function getIdent(result) {
    return result.id+'$'+result.checksum;
};

_.process = function process(kwargs) {
    var event_id = uuid().replace(/-/g, ''),
        checksum;

    kwargs['event_id'] = event_id;

    if(!kwargs['checksum']){
        checksum = kwargs['checksum'] = utils.construct_checksum(kwargs);
    } else {
        checksum = kwargs['checksum'];
    }

    kwargs['server_name'] = kwargs['server_name'] || this.name;
    kwargs['site'] = kwargs['site'] || this.site;
    kwargs['extra'] = kwargs['extra'] || {};
    
    // this will happen asynchronously. We don't care about it's response.
    this.send(kwargs);

    return {'id': event_id, 'checksum': checksum};
};

_.sendRemote = function sendRemote(message, headers, callback) {
    var self = this;
    var options = {
        host: self.dsn.host,
        path: self.dsn.path + '/' + self.dsn.project_id,
        headers: headers,
        method: 'POST'
    }, req = http[self.dsn.protocol].request(options, function(res){
        res.on('data', function(data) {
            //console.log(data.toString());
        });
    });
    req.on('error', function(e){
        //console.log(e.message);
    });
    req.end(message);
};

_.send = function send(kwargs) {
    var self = this;
    zlib.deflate(JSON.stringify(kwargs), function(err, buff) {
        var message = buff.toString('base64');
        //TODO: refactor this to not blast out to all servers at once.
        var timestamp = new Date().getTime()/1000,
            signature = utils.get_signature(self.dsn.public_key, message, timestamp),
            headers = {
                'X-Sentry-Auth': utils.get_auth_header(signature, timestamp),
                'Content-Type': 'application/octet-stream',
                'Content-Length': message.length,
            };
            
        self.sendRemote(message, headers);
    });
};

_.createFromText =
_.create_from_text = function createFromText(message, kwargs, callback) {
    if(!callback && typeof kwargs === 'function') {
        callback = kwargs;
        kwargs = {};
    } else {
        kwargs = kwargs || {};
    }
    kwargs['message'] = message;
    kwargs['sentry.interfaces.Message'] = {
        message: message,
        params: {}
    };
    var result = this.process(kwargs);
    if(callback) callback(result);
};

_.createFromError =
_.create_from_exception =
_.create_from_error = function createFromError(err, kwargs, callback) {
    var self = this;
    if(!callback && typeof kwargs === 'function') {
        callback = kwargs;
        kwargs = {};
    } else {
        kwargs = kwargs || {};
    }
    utils.parseStack(err.stack, function(e, frames) {
        kwargs['message'] = err.name+': '+err.message;
        kwargs['sentry.interfaces.Exception'] = {type:err.name, value:err.message};
        kwargs['sentry.interfaces.Stacktrace'] = {frames:frames};
        kwargs['culprit'] = err.name + ' in ' + err.stack.split('\n')[1].match(/^.*?\((.*?):\d+:\d+\)$/)[1].replace(process.cwd()+'/', '');
        var result = self.process(kwargs);
        if(callback) callback(result);
    });
};

module.exports.patchGlobal =
module.exports.patch_global = function patchGlobal(options) {
    var client = (options instanceof Client) ? options : new Client(options);
    process.on('uncaughtException', function(err) {
        client.createFromError(err, function(result) {
            var util = require('util');
            util.log('uncaughtException: '+client.get_ident(result));
        });
        // client.create_from_exception(err);
    });
};