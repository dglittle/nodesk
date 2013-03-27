nodesk
======

nodesk = node + odesk

for humanscripting on odesk

to run locally:
```
mongod &
node web.js
```

to run on heroku
```
heroku create
heroku addons:add mongohq:sandbox
heroku config:set HOST=http://CHANGE_ME.herokuapp.com
heroku config:set NODE_ENV=production
heroku config:set ODESK_API_KEY=CHANGE_ME
heroku config:set ODESK_API_KEY=CHANGE_ME
git push heroku master
```
