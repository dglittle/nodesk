
var Fiber = require('fibers')

_.read = _.slurp = function (f) {
    return '' + require('fs').readFileSync(f)
}

_.save = function (f, s) {
    require('fs').writeFileSync(f, s)
}

_.print = function (o) {
    if (typeof(o) == 'object') {
        console.log(_.json(o, true))
    } else {
        console.log(o)
    }
}

_.exit = function () {
    process.exit(1)
}

_.md5 = function (s) {
    return require('crypto').createHash('md5').update(s).digest("hex")    
}

_.run = function (f) {
    var c = Fiber.current
    if (c) c.yielding = true
    if (typeof(f) == 'function')
        var ret = Fiber(f).run()
    else
        if (f != c && f.started && !f.yielding)
            var ret = f.run()
    if (c) c.yielding = false
    return ret
}

_.yield = function () {
    return Fiber.yield()
}

_.p = _.prom = function () {
    var f = Fiber.current
    if (!f.promise) {
        f.promise = "waiting"
        return function () {
            if (arguments.length <= 1) {
                var arg = arguments[0]
                if (arg instanceof Error)
                    f.promise = { err : arg }
                else
                    f.promise = { val : arg }
            } else {
                f.promise = {
                    err : arguments[0],
                    val : arguments[1]
                }
            }
            _.run(f)
        }
    } else {
        while (f.promise == "waiting") _.yield()
        var p = f.promise 
        delete f.promise
        if (p.err) throw p.err
        return p.val
    }
}

_.parallel = function (funcs) {
    var set = _.prom()
    var remaining = funcs.length
    _.each(funcs, function (f) {
        _.run(function () {
            f()
            remaining--
            if (remaining <= 0) set()
        })
    })
    if (remaining <= 0) set()
    return _.prom()
}

_.consume = function (input, encoding) {
    if (encoding == 'buffer') {
        var buffer = new Buffer(1 * input.headers['content-length'])
        var cursor = 0
    } else {
        var chunks = []
        input.setEncoding(encoding || 'utf8')
    }
    
    var p = _.p()
    input.on('data', function (chunk) {
        if (encoding == 'buffer') {
            chunk.copy(buffer, cursor)
            cursor += chunk.length
        } else {
            chunks.push(chunk)
        }
    })
    input.on('end', function () {
        if (encoding == 'buffer') {
            p(buffer)
        } else {
            p(chunks.join(''))
        }
    })
    return _.p()
}

_.wget = function (url, params, encoding) {
    url = require('url').parse(url)
    
    var o = {
        method : params ? 'POST' : 'GET',
        hostname : url.hostname,
        path : url.path
    }
    if (url.port)
        o.port = url.port
    
    if (params && params.length != null) {
        var data = params
    } else {
        var data = _.values(_.map(params, function (v, k) { return k + "=" + encodeURIComponent(v) })).join('&')
    }
    o.headers = {
        "Content-Type" : "application/x-www-form-urlencoded; charset=UTF-8",
        "Content-Length" : Buffer.byteLength(data, 'utf8')
    }
    
    require(url.protocol.replace(/:/, '')).request(o, _.p()).end(data, 'utf8')
    return _.consume(_.p(), encoding)
}
