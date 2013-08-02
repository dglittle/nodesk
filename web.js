
testMode = process.argv[2] == "test"
if (testMode)
    console.log("== TEST MODE ==")

function defaultEnv(key, val) {
    if (!process.env[key])
        process.env[key] = val
}
defaultEnv("PORT", 5000)
defaultEnv("HOST", "http://localhost:5000")
defaultEnv("NODE_ENV", "production")
if (testMode)
    defaultEnv("MONGOHQ_URL", "mongodb://localhost:27017/nodeskTest")
else
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

    if (testMode) {
        app.use(function (req, res, next) {
            _.run(function () {
                var user = {
                    _id : 'test_id',
                    accessToken : 'test_token',
                    accessTokenSecret : 'test_secret',

                    ref : '12345',
                    name : 'Test User',
                    img : null,
                    country : 'USA',
                    profile : 'https://www.odesk.com/users/~0181d7da6c3671ac21'
                }
                req.logout = function () {}

                _.p(db.collection('users').update({ _id : user._id }, { $set : _.omit(user, '_id') }, { upsert: true }, _.p()))

                req.user = _.p(db.collection('users').findOne({ _id : user._id }, _.p()))

                next()
            })
        })
        app.get('/login', function (req, res) {
            res.redirect('/')
        })
    } else {
       require('./login.js')(db, app, process.env.HOST, process.env.ODESK_API_KEY, process.env.ODESK_API_SECRET)
    }

	app.all('*', function (req, res, next) {
		if (!req.user) {
			res.redirect('/login')
		} else {
			next()
		}
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
		o.OAuth.accessToken = u.accessToken
		o.OAuth.accessTokenSecret = u.accessTokenSecret
		return o
    }

    rpc.getUser = function (u) {
    	return _.omit(u, 'accessToken', 'accessTokenSecret', 'credentials')
    }

    rpc.logout = function (u) {
        this.req.session.destroy()
        this.req.logout()
    }

    rpc.getCredentials = function (u) {
        return u.credentials
    }

    rpc.setCredentials = function (u, c) {
        _.p(db.users.update({ _id : u._id }, { $set : { credentials : c } }, _.p()))
        return true
    }

    rpc.getTeams = function (u) {
        if (testMode)
            return getTestTeams()
        else
            return _.p(getO(u).get('hr/v2/teams', _.p())).teams
    }

    rpc.setTeam = function (u, team) {
    	_.p(db.users.update({ _id : u._id }, { $set : { team : team } }, _.p()))
    }

    rpc.postJob = function (u, jobParams) {
        if (testMode) return getTestJobs()[0]

        var o = getO(u)

        function getDateFromNow(fromNow) {
            var d = new Date(_.time() + fromNow)
            function zeroPrefix(x) { x = "" + x; return x.length < 2 ? '0' + x : x }
            return zeroPrefix(d.getMonth() + 1) + "-" + zeroPrefix(d.getDate()) + "-" + d.getFullYear()
        }

        return _.p(o.post('hr/v2/jobs', {
            buyer_team__reference : jobParams.team,
            title : jobParams.title,
            job_type : 'fixed-price',
            description : jobParams.description,
            end_date : getDateFromNow(1000 * 60 * 60 * 24 * 7),
            visibility : jobParams.visibility,
            budget : jobParams.budget,
            category : jobParams.category,
            subcategory : jobParams.subcategory,
            skills : jobParams.skills.split(/[, ]\s*/).join(';')
        }, _.p())).job
    }

    rpc.closeJob = function (u, job) {
        if (testMode) return true

        _.p(getO(u).delete('hr/v2/jobs/' + job, _.p()))
        return true
    }

    rpc.postIssueJob = function (u, company, team, category, subcategory, issueUrl, skills, budget, visibility, question) {

        if (testMode) return true

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

        if (testMode)
            return { jobs : getTestJobs(), engs : getTestEngs() }

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

        if (testMode)
            return getTestApps()

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
        if (testMode) return true
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
        if (testMode) return true
        getO(u).closeFixedPriceContract(
            u.credentials.odesk.user,
            u.credentials.odesk.pass,
            u.credentials.odesk.securityAnswer,
            company, team, job, comment, noPay)
        return true
    }

    rpc.sendMessage = function (u, to, subj, msg) {
        if (testMode) return true
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

function getTestTeams() {
    return [
        {
            "parent_team__id": "test",
            "is_hidden": "",
            "status": "active",
            "name": "Test Team 1",
            "company_name": "test",
            "parent_team__name": "test",
            "company__reference": "123",
            "parent_team__reference": "123",
            "reference": "1234",
            "id": "test"
        },
        {
            "parent_team__id": "test2",
            "is_hidden": "",
            "status": "active",
            "name": "Test Team 2",
            "company_name": "test2",
            "parent_team__name": "test2",
            "company__reference": "234",
            "parent_team__reference": "234",
            "reference": "2345",
            "id": "test2"
        }
    ]
}

function getTestJobs() {
    return [
        {
            "visibility": "invite-only",
            "status": "open",
            "public_url": "https://www.odesk.com/jobs/~01287e314daf4e286a",
            "budget": "20",
            "reference": "202557357",
            "num_candidates": "1",
            "start_date": "1368921600000",
            "num_new_candidates": "1",
            "filled_date": "",
            "category": "Web Development",
            "attachment_file_url": "",
            "off_the_network": "",
            "buyer_company__reference": "118",
            "buyer_team__reference": "416616",
            "num_active_candidates": "1",
            "created_time": "1369022107000",
            "last_candidacy_access_time": "",
            "duration": "",
            "created_by_name": "Greg Little",
            "description": "test job 1\n\n(task id: Zsr6sJLPuh)",
            "buyer_company__name": "oDesk",
            "subcategory": "Web Programming",
            "job_type": "fixed-price",
            "buyer_team__name": "oDesk R&D BootCamp",
            "buyer_team__id": "odesk:rndbootcamp",
            "end_date": "1369526400000",
            "title": "test job 1",
            "cancelled_date": "",
            "created_by": "greglittle",
            "count_total_applicants": "1",
            "count_new_applicants": "1",
            "count_total_candidates": "1"
        },
        {
            "visibility": "invite-only",
            "status": "open",
            "public_url": "https://www.odesk.com/jobs/~01287e314daf4e286a",
            "budget": "20",
            "reference": "202557356",
            "num_candidates": "0",
            "start_date": "1368921600000",
            "num_new_candidates": "0",
            "filled_date": "",
            "category": "Web Development",
            "attachment_file_url": "",
            "off_the_network": "",
            "buyer_company__reference": "118",
            "buyer_team__reference": "416616",
            "num_active_candidates": "0",
            "created_time": "1369022107000",
            "last_candidacy_access_time": "",
            "duration": "",
            "created_by_name": "Greg Little",
            "description": "test job 2\n\n(task id: Zsr6sJLPuh)",
            "buyer_company__name": "oDesk",
            "subcategory": "Web Programming",
            "job_type": "fixed-price",
            "buyer_team__name": "oDesk R&D BootCamp",
            "buyer_team__id": "odesk:rndbootcamp",
            "end_date": "1369526400000",
            "title": "test job 2",
            "cancelled_date": "",
            "created_by": "greglittle",
            "count_total_applicants": "0",
            "count_new_applicants": "0",
            "count_total_candidates": "0"
        }
    ]
}

function getTestEngs() {
    return [
        {
            "rent_percent": "10",
            "estimated_duration_id": "5",
            "provider__id": "testuser1",
            "fixed_price_upfront_payment": "0",
            "modified_time": "1365413598000",
            "job__reference": "202383623",
            "estimated_duration": "Less than 1 week",
            "roles": {
                "role": "buyer"
            },
            "weekly_limit_next_week": "",
            "offer__reference": "237286567",
            "buyer_team__reference": "416616",
            "engagement_end_date": "",
            "created_time": "1365413598000",
            "description": "",
            "provider_team__reference": "",
            "engagement_start_date": "1365379200000",
            "buyer_team__id": "odesk:rndbootcamp",
            "provider_team__id": "",
            "status": "active",
            "engagement_title": "test job A",
            "provider__reference": "1977857",
            "fixed_pay_amount_agreed": "30.00",
            "reference": "12967056",
            "fixed_charge_amount_agreed": "33.33",
            "engagement_job_type": "fixed-price",
            "job__title": "test job A",
            "provider__has_agency": ""
        },
        {
            "rent_percent": "10",
            "estimated_duration_id": "5",
            "provider__id": "testuser2",
            "fixed_price_upfront_payment": "0",
            "modified_time": "1365413598000",
            "job__reference": "202383623",
            "estimated_duration": "Less than 1 week",
            "roles": {
                "role": "buyer"
            },
            "weekly_limit_next_week": "",
            "offer__reference": "237286567",
            "buyer_team__reference": "416616",
            "engagement_end_date": "",
            "created_time": "1365413598000",
            "description": "",
            "provider_team__reference": "",
            "engagement_start_date": "1365379200000",
            "buyer_team__id": "odesk:rndbootcamp",
            "provider_team__id": "",
            "status": "active",
            "engagement_title": "test job B",
            "provider__reference": "1977857",
            "fixed_pay_amount_agreed": "30.00",
            "reference": "12967056",
            "fixed_charge_amount_agreed": "33.33",
            "engagement_job_type": "fixed-price",
            "job__title": "test job B",
            "provider__has_agency": ""
        }
    ]
}

function getTestApps() {
    return [
        {
            "estimated_duration_id": "5",
            "staffer_user__name": "Test User X",
            "created_type": "provider",
            "fixed_price_upfront_payment": "20",
            "modified_time": "1369120085000",
            "key": "~~5f881beee10f7943",
            "job__reference": "202562421",
            "has_buyer_signed": "",
            "is_hidden": "",
            "buyer_company__reference": "118",
            "engagement_end_date": "",
            "is_matching_preferences": "1",
            "created_time": "1369120085000",
            "description": "",
            "buyer_company__name": "oDesk",
            "my_role": "buyer",
            "engagement_start_date": "1369008000000",
            "buyer_team__id": "odesk:rndbootcamp",
            "buyer_user__id": "",
            "created_by": "testuserx",
            "provider_team__id": "testuserx",
            "has_provider_signed": "1",
            "provider_team__name": "Test User Solutions",
            "staffer_user__id": "testuserx",
            "provider__feedback_score": "0",
            "fixed_pay_amount_agreed": "100",
            "fixed_charge_amount_agreed": "111.11",
            "candidacy_status": "in_process",
            "staffer_user__reference": "1719674",
            "is_viewed": "",
            "message_from_provider": "Hello, this is my cover letter, which is a test cover letter for testing purposes, so we have something to show here.",
            "engagement_job_type": "fixed-price",
            "reason_code": "",
            "signed_by_buyer_user": "",
            "interview_status": "waiting_for_buyer",
            "buyer_team__name": "oDesk > oDesk R&D BootCamp",
            "provider__has_agency": "1",
            "rent_percent": "10",
            "provider__id": "testuserx",
            "reason_reference": "",
            "is_shortlisted": "",
            "estimated_duration": "Less than 1 week",
            "hiring_time": "",
            "roles": {
                "role": "buyer"
            },
            "signed_time_buyer": "",
            "attachment_file_url": "",
            "buyer_team__reference": "416616",
            "attachment_by": "",
            "buyer_user__name": "",
            "signed_by_provider_user": "testuserx",
            "provider_team__reference": "415879",
            "engagement__reference": "",
            "job__description": "task: https://github.com/dglittle/password-generator/issues/1\n\nsubmit result as pull request\n\nI'll hire the first person that answers these questions correctly in their cover letter:\n\n1. what is your github id?\n2. how long will this task take you?\n3. how would you convert an 8-bit hex number like \"f3\" into an integer?\n\n\n(task id: 4qLZAq23zw)",
            "provider_company__reference": "415879",
            "signed_time_provider": "1369120085000",
            "provider__name": "Test User X",
            "provider__total_hours": "",
            "provider__profile_url": "https://www.odesk.com/users/~0181d7da6c3671ac21",
            "status": "",
            "engagement_title": "",
            "message_from_buyer": "",
            "provider_company__name": "Test User Solutions",
            "provider__reference": "12345",
            "buyer_last_offer_user__id": "",
            "info_matching_preferences": {
                "prefs_total": "1",
                "prefs_match": "1",
                "match_details": {
                    "candidate_type_pref": {
                        "Value": "all",
                        "Match": "yes"
                    }
                }
            },
            "reference": "1234567",
            "reason_extra": "",
            "expiration_date": "",
            "job__title": "Add enhancement in open source javascript project: password-generator",
            "reason_inactive": "",
            "buyer_user__reference": "",
            "is_undecided": "1"
        },
        {
            "estimated_duration_id": "5",
            "staffer_user__name": "Test User Y",
            "created_type": "provider",
            "fixed_price_upfront_payment": "0",
            "modified_time": "1369120085000",
            "key": "~~5f881beee10f7943",
            "job__reference": "202562421",
            "has_buyer_signed": "",
            "is_hidden": "",
            "buyer_company__reference": "118",
            "engagement_end_date": "",
            "is_matching_preferences": "1",
            "created_time": "1369120085000",
            "description": "",
            "buyer_company__name": "oDesk",
            "my_role": "buyer",
            "engagement_start_date": "1369008000000",
            "buyer_team__id": "odesk:rndbootcamp",
            "buyer_user__id": "",
            "created_by": "testusery",
            "provider_team__id": "testusery",
            "has_provider_signed": "1",
            "provider_team__name": "Test User Solutions",
            "staffer_user__id": "testusery",
            "provider__feedback_score": "0",
            "fixed_pay_amount_agreed": "100",
            "fixed_charge_amount_agreed": "111.11",
            "candidacy_status": "in_process",
            "staffer_user__reference": "1719674",
            "is_viewed": "",
            "message_from_provider": "Hello, this is my cover letter, which is a test cover letter for testing purposes, so we have something to show here.",
            "engagement_job_type": "fixed-price",
            "reason_code": "",
            "signed_by_buyer_user": "",
            "interview_status": "waiting_for_buyer",
            "buyer_team__name": "oDesk > oDesk R&D BootCamp",
            "provider__has_agency": "1",
            "rent_percent": "10",
            "provider__id": "testusery",
            "reason_reference": "",
            "is_shortlisted": "",
            "estimated_duration": "Less than 1 week",
            "hiring_time": "",
            "roles": {
                "role": "buyer"
            },
            "signed_time_buyer": "",
            "attachment_file_url": "",
            "buyer_team__reference": "416616",
            "attachment_by": "",
            "buyer_user__name": "",
            "signed_by_provider_user": "testuserx",
            "provider_team__reference": "415879",
            "engagement__reference": "",
            "job__description": "task: https://github.com/dglittle/password-generator/issues/1\n\nsubmit result as pull request\n\nI'll hire the first person that answers these questions correctly in their cover letter:\n\n1. what is your github id?\n2. how long will this task take you?\n3. how would you convert an 8-bit hex number like \"f3\" into an integer?\n\n\n(task id: 4qLZAq23zw)",
            "provider_company__reference": "415879",
            "signed_time_provider": "1369120085000",
            "provider__name": "Test User Y",
            "provider__total_hours": "",
            "provider__profile_url": "https://www.odesk.com/users/~0181d7da6c3671ac21",
            "status": "",
            "engagement_title": "",
            "message_from_buyer": "",
            "provider_company__name": "Test User Solutions",
            "provider__reference": "12345",
            "buyer_last_offer_user__id": "",
            "info_matching_preferences": {
                "prefs_total": "1",
                "prefs_match": "1",
                "match_details": {
                    "candidate_type_pref": {
                        "Value": "all",
                        "Match": "yes"
                    }
                }
            },
            "reference": "1234567",
            "reason_extra": "",
            "expiration_date": "",
            "job__title": "Add enhancement in open source javascript project: password-generator",
            "reason_inactive": "",
            "buyer_user__reference": "",
            "is_undecided": "1"
        }
    ]
}
