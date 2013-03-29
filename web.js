
function defaultEnv(key, val) {
    if (!process.env[key])
        process.env[key] = val
}
defaultEnv("PORT", 5000)
defaultEnv("HOST", "http://localhost:5000")
defaultEnv("NODE_ENV", "production")
defaultEnv("MONGOHQ_URL", "mongodb://localhost:27017/nodesk")
defaultEnv("SESSION_SECRET", "blahblah")
defaultEnv("ODESK_API_KEY", "3f448b92c4aaf8918c0106bd164a1656")
defaultEnv("ODESK_API_SECRET", "e6a71b4f05467054")

///

function logError(err, notes) {
    console.log('error: ' + (err.stack || err))
	console.log('notes: ' + notes)
}

process.on('uncaughtException', function (err) {
    try {
		logError(err)
	} catch (e) {}
})

require('./u.js')
require('./nodeutil.js')
require('./new_u.js')
_.run(function () {

	var db = require('mongojs').connect(process.env.MONGOHQ_URL, ['jobs', 'users'])

	db.createCollection('logs', {capped : true, size : 10000}, function () {})
	logError = function (err, notes) {
	    console.log('error: ' + (err.stack || err))
		console.log('notes: ' + _.json(notes))
		db.collection('logs').insert({ error : '' + (err.stack || err), notes : notes })
	}

	var express = require('express')
	var app = express()

	app.use(express.cookieParser())
	app.use(function (req, res, next) {
		_.run(function () {
			req.body = _.consume(req)
		    next()
		})
	})

	var MongoStore = require('connect-mongo')(express)
	app.use(express.session({
		secret : process.env.SESSION_SECRET,
		cookie : { maxAge : 24 * 60 * 60 * 1000 },
		store : new MongoStore({
			url : process.env.MONGOHQ_URL,
			auto_reconnect : true,
			clear_interval : 3600
		})
	}))

	require('./login.js')(db, app, process.env.HOST, process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)

	app.all('*', function (req, res, next) {
		if (!req.user) {
			res.redirect('/login')
		} else {
			next()
		}
	})

	g_rpc_version = 1

	app.get('/', function (req, res) {
		var indexHtml = _.read('./index.html').replace(/RPC_VERSION/g, g_rpc_version)
		res.send(indexHtml)
	})

	var rpc = {}
	app.all(/\/rpc\/v(\d+)/, function (req, res) {
		if (g_rpc_version != req.params[0])
			throw new Error('version mismatch')
        _.run(function () {
            var input = _.unJson(req.method.match(/post/i) ? req.body : _.unescapeUrl(req.url.match(/\?(.*)/)[1]))
            function runFunc(input) {
        		return rpc[input.func].apply(null, [req.user].concat(input.args))
            }
            if (input instanceof Array)
                var output = _.map(input, runFunc)
            else
                var output = runFunc(input)
            var body = _.json(output) || "null"
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body)
            })
            res.end(body)
        })
    })

    function getO(u) {
		var odesk = require('node-odesk')
		var o = new odesk(process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)
		o.OAuth.accessToken = u.accessToken
		o.OAuth.accessTokenSecret = u.accessTokenSecret
		return o
    }

    rpc.getUser = function (u) {
    	return _.omit(u, 'accessToken', 'accessTokenSecret')
    }

    rpc.getTeams = function (u) {
		return _.p(getO(u).get('hr/v2/teams', _.p())).teams
    }

    rpc.setTeam = function (u, team) {
    	_.p(db.users.update({ _id : u._id }, { $set : { team : team } }, _.p()))
    }

    rpc.postJob = function (u, jobParams) {
    	return _.p(getO(u).post('hr/v2/jobs', jobParams, _.p())).job.reference
    }

    rpc.getJobs = function (u, team) {
    	return _.filter(_.oDesk_getAll(getO(u), 'hr/v2/jobs', {
    		buyer_team__reference : team.reference,
    		status : 'open'
    	}), function (j) { return j.job_type == 'fixed-price'})
    }

    rpc.getEngs = function (u, team) {
    	return _.filter(_.oDesk_getAll(getO(u), 'hr/v2/engagements', {
    		buyer_team__reference : team.reference,
            status : 'active'
    	}), function (e) { return e.engagement_job_type == 'fixed-price' })
    }

    rpc.getJobsAndEngs = function (u, team) {
        var o = getO(u)

        var jobs = null
        var engs = null
        _.parallel([
            function () {
                jobs = _.oDesk_getAll(o, 'hr/v2/jobs', {
                    buyer_team__reference : team.reference,
                    created_by : u.ref
                })
            },
            function () {
                engs = _.oDesk_getAll(o, 'hr/v2/engagements', {
                    buyer_team__reference : team.reference,
                    status : 'active'
                })
            }
        ])

        var myJobs = _.makeSet(_.map(jobs, function (j) { return j.reference }))
        jobs = _.filter(jobs, function (j) { return j.status == 'open' && j.job_type == 'fixed-price'})

        engs = _.filter(engs, function (e) { return myJobs[e.job__reference] && e.engagement_job_type == 'fixed-price' })

        return {
            jobs : jobs,
            engs : engs
        }
    }

    rpc.getApps = function (u, job) {
    	var o = getO(u)
    	var apps = _.oDesk_getAll(o, 'hr/v2/offers', {
    		buyer_team__reference : job.buyer_team__reference,
    		job__reference : job.reference
    	})
    	_.parallel(_.map(apps, function (app, i) {
    		return function () {
    			apps[i] = _.p(o.get('hr/v2/offers/' + app.reference, _.p())).offer
    		}
    	}))
    	return apps
    }

    rpc.hire = function (u, app) {
    	var o = getO(u)
    	_.p(o.post('hr/v1/jobs/' + app.job__reference + '/candidates/' + app.reference + '/hire', {
            'engagement-title' : app.job__title,
            // "keep-open" : "yes"
            // "date" : "1-22-2013",
            // "weekly-limit" : 4,
            // "visibility" : "public",
    	}, _.p()))

    	var e = _.p(o.get('hr/v2/engagements', {
    		provider__reference : app.provider__reference,
    		job__reference : app.job__reference
    	}, _.p())).engagements.engagement

    	e.provider__name = app.provider__name

    	_.p(db.jobs.update({ _id : app.job__reference }, { $set : _.object(['engs.' + e.reference, e]) }, _.p()))

    	return e
    }

    rpc.sendMessage = function (u, to, subj, msg) {
    	return _.p(getO(u).post('mc/v1/threads/' + u._id, {
    		recipients : to,
    		subject : subj,
    		body : msg
    	}, _.p())).thread_id
    }

/*
    rpc.pay = function (u, eng) {
    	return _.p(getO(u).post('hr/v2/teams/' + eng.buyer_team__reference + '/adjustments', {
            engagement__reference : eng.reference,
            charge_amount : eng.fixed_charge_amount_agreed,
            comments : "Thanks!"
        }, _.p())).adjustment
    }
*/

	app.use(function(err, req, res, next) {
		logError(err, {
			session : req.session,
			user : req.user
		})
		next(err)
	})

	app.use(express.errorHandler({
		dumpExceptions: true,
		showStack: true
	}))

	app.listen(process.env.PORT, function() {
		console.log("go to " + process.env.HOST)
	})
})
