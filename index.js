'use strict';

// Load dev environment if not on Bluemix
if (!process.env.VCAP_SERVICES) {
  require('dotenv').load();
}

// Required Libraries
var Path           = require('path');
var Hapi           = require('hapi');
var HapiAuthCookie = require('hapi-auth-cookie');
var Inert          = require('inert');
var Bell           = require('bell');
var Pusher         = require('pusher');
var Twitter        = require('twitter');
var GraphDataStore = require('gds-wrapper');

// Config services
// VCAP Services
var vcapServices = JSON.parse(process.env.VCAP_SERVICES);

// Graph Data Store
var graphService = 'GraphDataStore';
if (vcapServices[graphService] && vcapServices[graphService].length > 0) {
  var GraphDataStoreConfig = vcapServices[graphService][0];
} else {
  console.error('No GDS vars');
}

// Set up the DB
var graphClient = GraphDataStore({
  url: GraphDataStoreConfig.credentials.apiURL,
  username: GraphDataStoreConfig.credentials.username,
  password: GraphDataStoreConfig.credentials.password,
});

// Process Twitter Handles
var TWITTER = JSON.parse(process.env.TWITTER);

// Setup Pusher
var PUSHER = JSON.parse(process.env.PUSHER);
var pusher = new Pusher({
    appId: PUSHER.appId,
    key: PUSHER.key,
    secret: PUSHER.secret,
    encrypted: PUSHER.encrypted
  });
  pusher.port = PUSHER.port;

// Instantiate the server
var server = new Hapi.Server({
  debug: {
    request: ['error', 'good'],
  },
  connections: {
    routes: {
      files: {
        relativeTo: Path.join(__dirname, 'public'),
      },
    },
  },
});

// Set Hapi Connections
server.connection({
  host: process.env.VCAP_APP_HOST || 'localhost',
  port: process.env.VCAP_APP_PORT || 3000,
});

// Hapi Log
server.log(['error', 'database', 'read']);

// Register Hapi Plugins
server.register(Inert, function() {});
server.register(Bell, function() {});
server.register(HapiAuthCookie, function() {});

// Hapi Auth
server.state('token');
server.state('secret');
server.auth.strategy('session', 'cookie', {
    cookie: 'sid',
    password: 'cookie_encryption_password',
    redirectTo: '/login'
});
server.auth.strategy('twitter', 'bell', {
      provider: 'twitter',
      password: 'cookie_encryption_password',
      clientId: TWITTER.cKey,
      clientSecret: TWITTER.cSecret,
      isSecure: false,
  });
server.route({
      method: ['GET', 'POST'], // Must handle both GET and POST
      path: '/login',          // The callback endpoint registered with the provider
      config: {
          auth: 'twitter',
          handler: function (request, reply) {

              if (!request.auth.isAuthenticated) {
                  return reply('Authentication failed due to: ' + request.auth.error.message);
              }

              return reply.redirect('/twitter/' + request.auth.credentials.profile.username).state('secret', request.auth.credentials.secret).state('token', request.auth.credentials.token);
          }
      }
  });
server.route({
    method: 'GET',
    path: '/logout',
    config: {
        handler: function logoutHandler(request, reply) {
            // Clear the cookie
            request.auth.session.clear();

            return reply.redirect('/');
        }
    }
});

// Static site
server.route({
  method: 'GET',
  path: '/{param*}',
  handler: {
    directory: {
      path: '.',
      redirectToSlash: true,
      index: true,
    },
  },
});

// User Check
var graphVertextCreate = function(user, screenName) {
  var gremlinLookupQuery = [
    'g',
    'V()',
    'has(\'handle\',\'' + user.screen_name.toLowerCase() + '\')',
  ];
  graphClient.gremlin(gremlinLookupQuery, function(error, response, body) {
    console.log('---Check Twitter Handle--');
    console.log(error, body);
    console.log('---Check Twitter Handle--');
    if (!error) {
      var data = JSON.parse(body).result.data;
      if (data.length < 1) {
        graphClient.vertices.create({
            'name': user.name,
            'handle': user.screen_name.toLowerCase(),
            'idStr': user.id_str
          }, function(e, r, b) {
            console.log('---Add Twitter Handle--');
            console.log(e, b.result);
            createEdge(screenName, user.screen_name);
            console.log('---Add Twitter Handle--');
          });
      } else {
        console.log('FOUND: '+user.screen_name);
        createEdge(screenName, user.screen_name);
      }
    }
  });
};

// Process Edge
var createEdge = function(twitterHandle, twitterFollowerHandle) {
  if (twitterHandle.toLowerCase() != twitterFollowerHandle.toLowerCase()) {
    console.log('---Create Edge---');
    // Check Edge
    var gremlinEdgeCheck = [
      'g',
      'V()',
      'has(\'handle\',\'' + twitterHandle.toLowerCase() + '\')',
      'out()',
      'has(\'handle\',\'' + twitterFollowerHandle.toLowerCase() + '\')',
    ];
    graphClient.gremlin(gremlinEdgeCheck, function(error, response, body) {
      if (JSON.parse(body).result.data.length < 1) {
        var gremlinLookupQuery = [
          'g',
          'V()',
          'has(\'handle\',\'' + twitterHandle.toLowerCase() + '\')',
        ];
        graphClient.gremlin(gremlinLookupQuery, function(error, response, body) {
          var twitterHandleID1 = JSON.parse(body).result.data[0].id;
          var gremlinLookupQuery = [
            'g',
            'V()',
            'has(\'handle\',\'' + twitterFollowerHandle.toLowerCase() + '\')',
          ];
          graphClient.gremlin(gremlinLookupQuery, function(error, response, body) {
            var twitterHandleID2 = JSON.parse(body).result.data[0].id;
            graphClient.edges.create('follows', twitterHandleID1, twitterHandleID2, function(e, r, b) {
              console.log(e, b.result.data);
              console.log('---Create Edge---');
            });
          });
        });
      } else {
        console.log('---Edge Exists---');
      }
    });
  }
};

// Pull the Followers
var getFollowers = function(screenName, cursorId, counter) {

  var params = {
    screen_name: screenName,
    skip_status: true,
    count: 200,
  };

  if (typeof cursorId !== 'undefined') {
    params.cursor = cursorId;
  }

  if (typeof counter == 'undefined') {
    counter = 0;
  }

  twitterClient.get('friends/list', params, function(error, tweets, response) {

    if (!error) {
      for (var i = 0; i < tweets.users.length; i++) {
        var user = tweets.users[i];
        graphVertextCreate(user, screenName);
      }

      if (tweets.next_cursor > 0 && counter < 5) {
        counter++;
        setTimeout(function () {
          // getFollowers(screenName, tweets.next_cursor, counter);
        }, 5000);
      } else {
        getTwitterHandleGraph(screenName);
      }
    } else {
      console.warn(error);
      console.log('----');
      getTwitterHandleGraph(screenName);
    }

  });
};

// Get the graph for a given twitter handle
var getTwitterHandleGraph = function(twitterHandle) {
  console.log('--Get Twitter Graph--');
  var gremlinTwitterHandleGraph = [
    'g',
    'V()',
    'has(\'handle\',\'' + twitterHandle.toLowerCase() + '\')',
  ];
  graphClient.gremlin(gremlinTwitterHandleGraph, function(e, r, b) {
    if (e) console.error(e);
    console.log(JSON.parse(b))
    var originalTwitter = JSON.parse(b).result.data[0].properties;
    console.log(originalTwitter);
    var gremlinTwitterHandleGraph = [
      'g',
      'V()',
      'has(\'handle\',\'' + twitterHandle.toLowerCase() + '\')',
      'out()',
    ];
    graphClient.gremlin(gremlinTwitterHandleGraph, function(e, r, b) {
      console.error(e);
      var connections = JSON.parse(b).result.data;
      console.log(connections.length);
      for (var i = 0; i < connections.length; i++) {
        var connection = connections[i].properties;
        // console.log(connection);
        pusher.trigger('presentation', 'twitterConnection', {
          "original": {
            "id": originalTwitter.idStr[0].value,
            "name": originalTwitter.name[0].value,
            "handle": originalTwitter.handle[0].value,
          },
          "follower": {
            "id": connection.idStr[0].value,
            "name": connection.name[0].value,
            "handle": connection.handle[0].value,
          }
        });
      }
      console.log('--Get Twitter Graph--');
    });
  });
};

// Process a twitter handle for followers
server.route({
  method: 'GET',
  path: '/twitter/{twitterHandle}',
  handler: function(request, reply) {
    var twitterClient = new Twitter({
        consumer_key: TWITTER.cKey,
        consumer_secret: TWITTER.cSecret,
        access_token_key: request.state['token'],
        access_token_secret: request.state['secret'],
      });
    // Twitter handle
    var twitterHandle = request.params.twitterHandle;
    // User
    var params = {
      screen_name: twitterHandle
    }
    twitterClient.get('users/lookup', params, function(error, tweets, response) {
      if (!error) {
        graphVertextCreate(tweets[0], twitterHandle);
      } else {
        console.error(error);
      }
    });
    // Followers

    // Pull the Followers
    var getFollowers = function(screenName, cursorId, counter) {

      var params = {
        screen_name: screenName,
        skip_status: true,
        count: 200,
      };

      if (typeof cursorId !== 'undefined') {
        params.cursor = cursorId;
      }

      if (typeof counter == 'undefined') {
        counter = 0;
      }

      twitterClient.get('friends/list', params, function(error, tweets, response) {

        if (!error) {
          for (var i = 0; i < tweets.users.length; i++) {
            var user = tweets.users[i];
            graphVertextCreate(user, screenName);
          }

          if (tweets.next_cursor > 0 && counter < 5) {
            counter++;
            getFollowers(screenName, tweets.next_cursor, counter);
          } else {
            getTwitterHandleGraph(screenName);
          }
        } else {
          console.warn(error);
          console.log('----');
          getTwitterHandleGraph(screenName);
        }

      });
    };
    getFollowers(twitterHandle);
    // reply({processing:twitterHandle});
    reply.redirect('/controller.html');
  },
});

// Start Hapi
server.start(function(err) {
  if (err) {
    console.log(err);
  } else {
    console.log('Server running at:', server.info.uri);
  }
});
