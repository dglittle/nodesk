
var passport = require('passport')
var odesk = require('node-odesk')
var _ = require('gl519')

module.exports = function (db, app, host, odeskApiKey, odeskApiSecret) {
	var OAuthStrategy = require('passport-oauth').OAuthStrategy;

	passport.use('oDesk', new OAuthStrategy({
	    requestTokenURL: 'https://www.odesk.com/api/auth/v1/oauth/token/request',
	    accessTokenURL: 'https://www.odesk.com/api/auth/v1/oauth/token/access',
	    userAuthorizationURL: 'https://www.odesk.com/services/api/auth',
	    consumerKey: odeskApiKey,
	    consumerSecret: odeskApiSecret,
	    callbackURL: host + '/login-callback'
	}, function(token, tokenSecret, profile, done) {
		var o = new odesk(odeskApiKey, odeskApiSecret)
		o.OAuth.accessToken = token
		o.OAuth.accessTokenSecret = tokenSecret
		o.get('auth/v1/info', function(err, data) {
			if (err) return done(err)
		    var user = {
		    	_id : data.auth_user.uid,
		    	accessToken : token,
		    	accessTokenSecret : tokenSecret,

		    	ref : data.info.ref,
		    	name : data.auth_user.first_name + " " + data.auth_user.last_name,
		    	img : data.info.portrait_100_img,
		    	country : data.info.location.country,
		    	profile : data.info.profile_url
		    }
		    db.collection('users').update({ _id : user._id }, { $set : _.omit(user, '_id') }, { upsert: true }, function (err) {
		    	if (err) return done(err)
	    		done(null, user)
		    })
		})
	}))

	passport.serializeUser(function (user, done) {
		done(null, user._id)
	})

	passport.deserializeUser(function (id, done) {
		db.collection('users').findOne({ _id : id }, function (err, data) {
	    	if (err) return done(err)
			done(null, data)
		})
	})

	app.use(passport.initialize())
	app.use(passport.session())

	app.get('/login', passport.authenticate('oDesk'))
	app.get('/login-callback', passport.authenticate('oDesk', {
		successRedirect: '/',
		failureRedirect: '/login'
	}))
}
