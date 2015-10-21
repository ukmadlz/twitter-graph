'use strict';

// Load dev environment if not on Bluemix
if (!process.env.VCAP_SERVICES) {
  require('dotenv').load();
}

// Required Libraries
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
