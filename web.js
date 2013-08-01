
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
defaultEnv("GITHUB_CLIENT_ID", "c8216b1247ddcf0b1eff")
defaultEnv("GITHUB_CLIENT_SECRET", "7543eff6fc9436e1daaa99e533edafdc5d39720f")

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

var _ = require('gl519')
_.run(function () {

	var db = require('mongojs').connect(process.env.MONGOHQ_URL, ['users'])

	db.createCollection('logs', {capped : true, size : 10000}, function () {})
	logError = function (err, notes) {
	    console.log('error: ' + (err.stack || err))
		console.log('notes: ' + _.json(notes))
		db.collection('logs').insert({ error : '' + (err.stack || err), notes : notes })
	}

	var express = require('express')
	var app = express()

    _.serveOnExpress(express, app)

    app.use(express.static(__dirname + '/static'))

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

    // login stuff
    var passport = require('passport')

    OdeskStrategy = require('passport-odesk').Strategy
    passport.use(new OdeskStrategy({
            consumerKey: process.env.ODESK_API_KEY,
            consumerSecret: process.env.ODESK_API_SECRET,
            callbackURL: process.env.HOST + "/login/odesk/callback"
        },
        function(accessToken, tokenSecret, profile, done) {
            done(null, {
                id : profile.id,
                accessToken : accessToken,
                tokenSecret : tokenSecret
            })
        }
    ))

    GitHubStrategy = require('passport-github').Strategy
    passport.use(new GitHubStrategy({
            clientID: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            callbackURL: process.env.HOST + "/login/github/callback",
            scope : ['public_repo'],
            customHeaders: { "User-Agent": "gitDesk/1.0" }
        },
        function(accessToken, refreshToken, profile, done) {
            done(null, {
                id : profile.username,
                accessToken : accessToken
            })
        }
    ))

    passport.serializeUser(function (user, done) {
        done(null, "none");
    })

    passport.deserializeUser(function (obj, done) {
        done(null, {});
    })    

    app.use(passport.initialize())
    app.use(passport.session())

    app.use(function (req, res, next) {
        db.users.findOne({ _id : req.session.user }, function (err, data) {
            if (err) throw err
            req.user = data
            next()
        })
    })

    app.get('/login/odesk', passport.authenticate('odesk'))
    app.get('/login/odesk/callback', passport.authenticate('odesk', { failureRedirect: '/' }), function (req, res) {
        req.session.user = req.user.id
        db.users.update({ _id : req.user.id }, { $set : {
            odesk : {
                id : req.user.id,
                auth : {
                    accessToken : req.user.accessToken,
                    tokenSecret : req.user.tokenSecret
                }
            }
        }}, { upsert : true }, function (err) {
            if (err) throw err
            res.redirect('/')
        })
    })

    app.get('/login/github', passport.authenticate('github'))
    app.all('/login/github/callback', passport.authenticate('github', { failureRedirect: '/' }), function(req, res) {
        db.users.update({ _id : req.session.user }, { $set : {
            github : {
                id : req.user.id,
                auth : {
                    accessToken : req.user.accessToken
                }
            }
        }}, function (err) {
            if (err) throw err
            res.redirect('/')
        })
    })

    app.get('/logout', function (req, res) {
        req.session.user = null
        req.session.destroy()
        req.logout()
        res.redirect('/')
    })

	g_rpc_version = 1

	app.get('/', function (req, res) {
        res.cookie('rpc_version', g_rpc_version, { httpOnly: false})
        res.cookie('rpc_token', _.randomString(10), { httpOnly: false})
        res.sendfile('./index.html')
	})

	var rpc = {}
	app.all(/\/rpc\/([^\/]+)\/([^\/]+)/, function (req, res) {
		if (g_rpc_version != req.params[0])
			throw new Error('version mismatch')
        if (!req.cookies.rpc_token || req.cookies.rpc_token != req.params[1])
            throw new Error('token mismatch')
        _.run(function () {
            var input = _.unJson(req.method.match(/post/i) ? req.body : _.unescapeUrl(req.url.match(/\?(.*)/)[1]))
            function runFunc(input) {
        		return rpc[input.func].apply({ req : req, res : res }, [req.user].concat(input.args))
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

    var getO = function (u) {
		var odesk = require('node-odesk-utils')
		var o = new odesk(process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)
		o.OAuth.accessToken = u.odesk.auth.accessToken
		o.OAuth.accessTokenSecret = u.odesk.auth.tokenSecret
		return o
    }

    rpc.getUser = function (u) {
        if (u) {
            if (u.odesk) delete u.odesk.auth
            if (u.github) delete u.github.auth
        }
        return u
    }

    rpc.unlinkGithub = function (u) {
        _.p(db.users.update({ _id : u._id }, {
            $unset : { github : null }
        }, _.p()))
    }

    rpc.getCredentials = function (u) {
        return u.credentials
    }

    rpc.setCredentials = function (u, c) {
        _.p(db.users.update({ _id : u._id }, { $set : { credentials : c } }, _.p()))
        return true
    }

    rpc.getTeams = function (u) {
        return _.p(getO(u).get('hr/v2/teams', _.p())).teams
    }

    rpc.setTeam = function (u, team) {
    	_.p(db.users.update({ _id : u._id }, { $set : { team : team } }, _.p()))
    }

    var skill_dict = _.makeSet(_.unJson(_.read('./skills.json')))

    rpc.postJob = function (u, jobParams) {
        if (!u.credentials) throw new Error('need to set credentials')

// work here


//     function validateSkills(skills) {
//         var skill_array = skills.split(/\s*,\s*/i)
//         skill_array = _.filter(skill_array, function(skill) { return skill_dict[skill] })
//         skills = skill_array.join(';')
// //      _.print('skills: ' + skills)
//         return skills
//     }






        var o = getO(u)

        var before = new Date(_.time() - 1000 * 60 * 10)
        before = JSON.stringify(before).slice(1, 20)

        var randomId = _.randomString(10)

        o.postFixedPriceJob(
            u.credentials.odesk.user,
            u.credentials.odesk.pass,
            u.credentials.odesk.securityAnswer,
            jobParams.company,
            jobParams.team,
            jobParams.category,
            jobParams.subcategory,
            jobParams.title,
            jobParams.description + '\n\n(task id: ' + randomId + ')',
            jobParams.skills.split(/[, ]\s*/).join(' '),
            jobParams.budget,
            jobParams.visibility)

        return _.find(o.getAll('hr/v2/jobs', {
            buyer_team__reference : jobParams.team,
            created_by : u.ref,
            status : 'open',
            created_time_from : before
        }), function (e) {
            return e.description.indexOf(randomId) >= 0
        })
    }

    rpc.closeJob = function (u, job) {
        _.p(getO(u).delete('hr/v2/jobs/' + job, _.p()))
        return true
    }

    rpc.postIssueJob = function (u, company, team, category, subcategory, issueUrl, skills, budget, visibility, question) {

        if (typeof(skills) == 'string')
            skills = skills.split(/[, ]\s*/)

        if (skills.length < 1) throw new Error('need at least one skill')

        var job_template = _.read('./job_template.txt')

        var m = issueUrl.match(/github\.com\/(.*?)\/(.*?)\/issues\/(\d+)/)
        var owner = m[1]
        var repo = m[2]
        var issueNum = m[3]
        var path = '/repos/' + owner + '/' + repo + '/issues/' + issueNum

        function do_template(s, obj) {
            return s.replace(/\{\{(.*?)\}\}/g, function (g0, g1) {
                with (obj) {
                    return eval(g1)
                }
            })
        }

        var issue = _.unJson(_.wget('https://api.github.com' + path))

        var info = {
            skills : skills,
            issueUrl : issueUrl,
            projectUrl : 'https://github.com/' + owner + '/' + repo,
            issueTitle : issue.title,
            repo : repo,
            questions : [
                'what is your github id?',
                'how long will this task take you?',
                question
            ]
        }

        var jobParams = {
            company : company,
            team : team,
            category : category,
            subcategory : subcategory,

            title : do_template('Add enhancement in open source {{skills[0]}} project: {{repo}}', info),
            description : do_template(job_template, info),
            skills : skills.join(' '),
            budget : budget,
            visibility : visibility
        }

        var job = rpc.postJob(u, jobParams)

        _.wget('PATCH', 'https://' + u.credentials.github.user + ':' + u.credentials.github.pass + '@api.github.com' + path,
            _.json({
                body : "I'm offering $" + (1*budget).toFixed(2) + " on oDesk for someone to do this task: " + job.public_url + '\n\n' + issue.body
            }))

        return true
    }

    rpc.getJobsAndEngs = function (u, team) {
        var o = getO(u)

        var jobs = null
        var engs = null

        _.parallel([
            function () {
                jobs = o.getAll('hr/v2/jobs', {
                    buyer_team__reference : team.reference,
                    created_by : u.ref,
                    status : 'open'
                })
            },
            function () {
                engs = o.getAll('hr/v2/engagements', {
                    buyer_team__reference : team.reference,
                    status : 'active'
                })
            }
        ])

        var engsJob = []
        _.parallel(_.map(engs, function (eng, i) {
            return function () {
                engsJob[i] = _.p(o.get('hr/v2/jobs/' + eng.job__reference, _.p())).job
            }
        }))

        jobs = _.filter(jobs, function (j) { return j.job_type == 'fixed-price' })

        engs = _.filter(engs, function (e, i) { return engsJob[i].created_by == u._id && e.engagement_job_type == 'fixed-price' })

        return {
            jobs : jobs,
            engs : engs
        }
    }

    rpc.getApps = function (u, job) {
    	var o = getO(u)

        // return o.getApplicants(
        //     u.credentials.odesk.user,
        //     u.credentials.odesk.pass,
        //     u.credentials.odesk.securityAnswer,
        //     job.reference)

    	var apps = o.getAll('hr/v2/offers', {
    		buyer_team__reference : job.buyer_team__reference,
    		job__reference : job.reference
    	})

        apps = _.filter(apps, function (app) {
            return !(app.is_hidden == "1") && (app.interview_status == "waiting_for_buyer")
        })

    	_.parallel(_.map(apps, function (app, i) {
    		return function () {
    			apps[i] = _.p(o.get('hr/v2/offers/' + app.reference, _.p())).offer
    		}
    	}))
    	return apps
    }

    rpc.hire = function (u, jobRef, appRef, title, keepOpen) {
    	var ret = _.p(getO(u).post('hr/v1/jobs/' + jobRef + '/candidates/' + appRef + '/hire', {
            'engagement-title' : title,
            'keep-open' : keepOpen ? "yes" : "no"
            // "date" : "1-22-2013",
            // "weekly-limit" : 4,
            // "visibility" : "public",
    	}, _.p()))
        return true
    }

    rpc.fire = function (u, company, team, job, comment, noPay) {
        getO(u).closeFixedPriceContract(
            u.credentials.odesk.user,
            u.credentials.odesk.pass,
            u.credentials.odesk.securityAnswer,
            company, team, job, comment, noPay)
        return true
    }

    rpc.sendMessage = function (u, to, subj, msg) {
    	return _.p(getO(u).post('mc/v1/threads/' + u._id, {
    		recipients : to,
    		subject : subj,
    		body : msg
    	}, _.p())).thread_id
    }

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
