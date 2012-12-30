
require('fibers')
var _ = require('underscore')
require('./fiberutil')
var settings = require('./_settings.js')
var fs = require('fs')

function createODesk(settings) {
	var o = {}

	o.sign = function(params) {
		var s = settings.secret
		var keys = _.keys(params)
		keys.sort()
		_.each(keys, function (e) { s += e + params[e] })
		return md5(s)
	}

	o.rest = function(method, url, params) {
		if (!params) params = {}
		params.api_key = settings.key
		if (settings.token) params.api_token = settings.token
		params.api_sig = o.sign(params)
		var ret = method.match(/^post$/i) ?
			wget(url, params) :
			wget(url + '?' + _.values(_.map(params, function (v, k) { return encodeURIComponent(k) + "=" + encodeURIComponent(v) })).join('&'))
		try { return JSON.parse(ret) } catch (e) { return ret }
	}

	o.getAuthenticationUrl = function() {
		var r = o.rest("post", "https://www.odesk.com/api/auth/v1/keys/frobs.json")
		settings.frob = r.frob
		return "https://www.odesk.com/services/api/auth/?api_key=" + settings.key + "&frob=" + settings.frob + "&api_sig=" + o.sign({ api_key : settings.key, frob : settings.frob }, settings.secret)
	}

	return o
}

run(function () {

	var o = createODesk(settings.odesk)
	if (!settings.odesk.frob) {
		console.log("go here: " + o.getAuthenticationUrl())
		fs.writeFileSync('_settings.js', 'module.exports = ' + JSON.stringify(settings, null, "    "))
		console.log("and run again...")
		return
	}
	if (!settings.odesk.token) {
		var r = o.rest("post", "https://www.odesk.com/api/auth/v1/keys/tokens.json", { frob : settings.odesk.frob })
		settings.odesk.token = r.token
		fs.writeFileSync('_settings.js', 'module.exports = ' + JSON.stringify(settings, null, "    "))
	}

	var r = o.rest("get", "https://www.odesk.com/api/team/v2/teamrooms.json")
	console.log("r = " + JSON.stringify(r))
})
