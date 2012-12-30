
require('fibers')
var crypto = require('crypto')
var _ = require('underscore')
var http = require('http')
var url = require('url')

md5 = function (s) {
    return crypto.createHash('md5').update(s).digest("hex")    
}

tryRun = function (f) {
    if (Fiber.current !== f) {
        try {
            f.run()
        } catch (e) {
            if (e instanceof Error) {
                if ("" + e == "Error: This Fiber is already running") {
                    // that's fine.. we really need to be able to check for "yielding"
                    return
                }
            }
            throw e
        }
    }
}

run = function (func) {
    Fiber(func).run()
}

promise = function () {
    var f = Fiber.current
    var done = false
    var val = null
    return {
        set : function (v) {
            done = true
            val = v
            tryRun(f)
        },
        get : function () {
            while (!done) {
                yield()
            }
            return val
        }
    }
}

wait = function (funcs) {
    var c = Fiber.current
    var waitingCount = 0
    _.each(funcs, function (f) {
        waitingCount++
        run(function () {
            f()
            waitingCount--
            tryRun(c)
        })
    })
    while (waitingCount > 0) yield()
}

// adapted from https://github.com/lm1/node-fiberize/blob/master/fiberize.js
fiberize = function () {
    var p = promise()

    var args = Array.prototype.slice.call(arguments)
    args.push(function () {
        p.set(Array.prototype.slice.call(arguments))
    })
    var result = args[0].apply(null, args.slice(1))
    
    var cb_args = p.get()
        
    var err = cb_args[0]
    if (err instanceof Error) throw err
    if (err == null) cb_args.shift()
    if (result !== undefined) result = [result].concat(cb_args)
    else result = cb_args
    if (result.length <= 1) result = result[0]
    return result
}

consume = function (input, encoding) {
    if (encoding == 'buffer') {
        var buffer = new Buffer(1 * input.headers['content-length'])
        var cursor = 0
    } else {
        var chunks = []
        input.setEncoding(encoding || 'utf8')
    }
    
    var p = promise()
    function onDone() {
        if (encoding == 'buffer') {
            p.set(buffer)
        } else {
            p.set(chunks.join(''))
        }
    }
    input.on('end', onDone)
    input.on('close', onDone)
    input.on('data', function (chunk) {
        if (encoding == 'buffer') {
            chunk.copy(buffer, cursor)
            cursor += chunk.length
        } else {
            chunks.push(chunk)
        }
    })
    return p.get()
}

wget = function (url, params, encoding) {
    var u = require('url').parse(url)
    
    var o = {
        method : params ? 'POST' : 'GET',
        hostname : u.hostname,
        path : u.path
    }
    if (u.port)
        o.port = u.port
    
    var data = ""
    var dataEnc = null
    if (params && params.length != null) {
        data = params
        o.headers = {
            "Content-Length" : data.length
        }
    } else {
        data = _.values(_.map(params, function (v, k) { return encodeURIComponent(k) + "=" + encodeURIComponent(v) })).join('&')
        
        o.headers = {
            "Content-Type" : "application/x-www-form-urlencoded",
            "Content-Length" : Buffer.byteLength(data, 'utf8')
        }
        
        dataEnc = "utf8"
    }
    
    var p = promise()
    var req = require(u.protocol.replace(/:/, '')).request(o, function (res) {
        run(function () {
            p.set(consume(res, encoding))
        })
    })
    req.end(data, dataEnc)
    return p.get()
}

