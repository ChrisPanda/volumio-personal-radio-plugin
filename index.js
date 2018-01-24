'use strict';

// This Volumio plugin provides Korean Radios (KBS, MBC) and Linn radio.

var libQ = require('kew');
var fs = require('fs-extra');
var config = require('v-conf');
var unirest = require('unirest');
var crypto = require('crypto');

module.exports = ControllerPersonalRadio;

function ControllerPersonalRadio(context) {
	var self = this;

  self.context = context;
  self.commandRouter = this.context.coreCommand;
  self.logger = this.context.logger;
  self.configManager = this.context.configManager;
  self.state = {};
  self.stateMachine = self.commandRouter.stateMachine;

  self.logger.info("ControllerPersonalRadio::constructor");
}

ControllerPersonalRadio.prototype.onVolumioStart = function()
{
  var self = this;

  self.configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
  self.getConf(self.configFile);


  return libQ.resolve();
};

ControllerPersonalRadio.prototype.getConfigurationFiles = function () {
  return ['config.json'];
};

ControllerPersonalRadio.prototype.onStart = function() {
  var self = this;

  self.mpdPlugin = this.commandRouter.pluginManager.getPlugin('music_service','mpd');

  self.loadRadioI18nStrings();
  self.addRadioResource();
  self.addToBrowseSources();

  self.serviceName = "personal_radio";

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.onStop = function() {
  var self = this;

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.onRestart = function() {
  var self = this;

  return libQ.resolve();
};


// Configuration Methods -----------------------------------------------------
ControllerPersonalRadio.prototype.getConf = function(configFile) {
  var self = this;

  self.config = new (require('v-conf'))();
  self.config.loadFile(configFile);
};

ControllerPersonalRadio.prototype.setConf = function(varName, varValue) {
  var self = this;

  //Perform your installation tasks here
};


// Playback Controls ---------------------------------------------------------
ControllerPersonalRadio.prototype.addToBrowseSources = function () {
  var self = this;

  self.commandRouter.volumioAddToBrowseSources({
    name: self.getRadioI18nString('PLUGIN_NAME'),
    uri: 'kradio',
    plugin_type: 'music_service',
    plugin_name: "personal_radio",
    albumart: '/albumart?sourceicon=music_service/personal_radio/personal_radio.svg'
  });
};

ControllerPersonalRadio.prototype.handleBrowseUri = function (curUri) {
  var self = this;
  var response;

  self.logger.info("ControllerPersonalRadio::handleBrowseUri");
  if (curUri.startsWith('kradio')) {
    if (curUri === 'kradio') {
      response = self.getRootContent();
    }
    else if (curUri === 'kradio/kbs') {
      response = self.getRadioContent('kbs');
    }
    else if (curUri === 'kradio/sbs') {
        response = self.getRadioContent('sbs');
    }
    else if (curUri === 'kradio/mbc') {
      response = self.getRadioContent('mbc');
    }
    else if (curUri === 'kradio/linn') {
      response = self.getRadioContent('linn');
    }
    else {
      response = libQ.reject();
    }
  }

  return response
    .fail(function (e) {
      self.logger.info('[' + Date.now() + '] ' + 'ControllerPersonalRadio::handleBrowseUri failed');
      libQ.reject(new Error());
    });
};


ControllerPersonalRadio.prototype.getRootContent = function() {
  var self=this;
  var response;
  var defer = libQ.defer();

  response = JSON.parse(JSON.stringify(self.baseNavigation));
  response.navigation.prev.uri = '/';
  for (var i in self.rootRadios) {
      var radio = {
          service: self.serviceName,
          type: 'folder',
          title: self.rootRadios[i].title,
          icon: 'fa fa-folder-open-o',
          uri: self.rootRadios[i].uri
      };
      response.navigation.lists[0].items.push(radio);
  }
  defer.resolve(response);

  return defer.promise;
};

ControllerPersonalRadio.prototype.getRadioContent = function(station) {
  var self=this;
  var response;
  var radioStation;
  var defer = libQ.defer();

  switch (station) {
    case 'kbs':
      radioStation = self.radioStations.kbs;
      break;
    case 'sbs':
      radioStation = self.radioStations.sbs;
      break;
    case 'mbc':
      radioStation = self.radioStations.mbc;
      break;
    case 'linn':
      radioStation = self.radioStations.linn;
  }

  response = JSON.parse(JSON.stringify(self.baseNavigation));
  for (var i in radioStation) {
    var channel = {
      service: self.serviceName,
      type: 'mywebradio',
      title: radioStation[i].title,
      artist: '',
      album: '',
      icon: 'fa fa-music',
      uri: radioStation[i].uri
    };
    response.navigation.lists[0].items.push(channel);
  }
  defer.resolve(response);

  return defer.promise;
};

ControllerPersonalRadio.prototype.clearAddPlayTrack = function(track) {
  var self = this;
  var defer = libQ.defer();

  return self.mpdPlugin.sendMpdCommand('stop', [])
    .then(function() {
        return self.mpdPlugin.sendMpdCommand('clear', []);
    })
    .then(function() {
        return self.mpdPlugin.sendMpdCommand('add "'+track.uri+'"',[]);
    })
    .then(function () {
      self.commandRouter.pushToastMessage('info',
        self.getRadioI18nString('PLUGIN_NAME'),
        self.getRadioI18nString('WAIT_FOR_RADIO_CHANNEL'));

      return self.mpdPlugin.sendMpdCommand('play', []).then(function () {
        switch (track.radioType) {
          case 'kbs':
          case 'sbs':
          case 'mbc':
            return self.mpdPlugin.getState().then(function (state) {
                return self.commandRouter.stateMachine.syncState(state, self.serviceName);
            });
            break;
          default:
            self.commandRouter.stateMachine.setConsumeUpdateService('mpd');
            return libQ.resolve();
        }
      })
    })
    .fail(function (e) {
      return defer.reject(new Error());
    });
};

ControllerPersonalRadio.prototype.seek = function (position) {
  var self = this;

  return self.mpdPlugin.seek(position);
};

ControllerPersonalRadio.prototype.stop = function() {
	var self = this;

  self.commandRouter.pushToastMessage(
      'info',
      self.getRadioI18nString('PLUGIN_NAME'),
      self.getRadioI18nString('STOP_RADIO_CHANNEL')
  );
  return self.mpdPlugin.stop().then(function () {
      return self.mpdPlugin.getState().then(function (state) {
          return self.commandRouter.stateMachine.syncState(state, self.serviceName);
      });
  });
};

ControllerPersonalRadio.prototype.pause = function() {
  var self = this;

  return self.mpdPlugin.pause().then(function () {
    return self.mpdPlugin.getState().then(function (state) {
        return self.commandRouter.stateMachine.syncState(state, self.serviceName);
    });
  });
};

ControllerPersonalRadio.prototype.resume = function() {
  var self = this;

  return self.mpdPlugin.resume().then(function () {
    return self.mpdPlugin.getState().then(function (state) {
        return self.commandRouter.stateMachine.syncState(state, self.serviceName);
    });
  });
};

ControllerPersonalRadio.prototype.explodeUri = function (uri) {
  var self = this;
  var defer = libQ.defer();
  var uris = uri.split("/");
  var channel = parseInt(uris[1]);
  var response;
  var query;
  var station;

  var baseResponse = {
      service: self.serviceName,
      type: 'track',
      trackType: self.getRadioI18nString('PLUGIN_NAME')
  };

  station = uris[0].substring(3);
  switch (uris[0]) {
    case 'webkbs':
      var userId = Math.random().toString(36).substring(2, 6) +
                   Math.random().toString(36).substring(2, 6);
      query = {
        id: userId,
        channel: channel+1
      };
      self.getStreamUrl(station, self.baseKbsStreamUrl, query)
        .then(function (KbsUri) {
          if (KbsUri  !== null) {
            var result = KbsUri.split("\n");
            var retCode = parseInt(result[0]);
            var streamUrl = result[1];

            response = {
              uri: streamUrl,
              service: self.serviceName,
              name: self.radioStations.kbs[channel].title,
              title: self.radioStations.kbs[channel].title,
              type: 'track',
              trackType: self.getRadioI18nString('PLUGIN_NAME'),
              radioType: station,
              albumart: '/albumart?sourceicon=music_service/personal_radio/kbs.svg'
            };

          }
          defer.resolve(response);
        });
      break;

    case 'websbs':
      query = {
        device: 'pc'
      };
      var baseSbsStreamUrl = self.baseSbsStreamUrl + self.radioStations.sbs[channel].channel;
      self.getStreamUrl(station, baseSbsStreamUrl, query)
        .then(function (SbsUri) {


          response = {
            uri: streamUrl,
            service: self.serviceName,
            name: self.radioStations.sbs[channel].title,
            title: self.radioStations.sbs[channel].title,
            type: 'track',
            trackType: self.getRadioI18nString('PLUGIN_NAME'),
            radioType: station,
            albumart: '/albumart?sourceicon=music_service/personal_radio/kbs.svg'
          };
          defer.resolve(response);
        });
      break;

    case 'webmbc':
      query = {
        channel: self.radioStations.mbc[channel].channel,
        agent: 'agent',
        protocol: 'RTMP'
      };
      self.getStreamUrl(station, self.baseMbcStreamUrl, query)
        .then(function (MbcUri) {
          if (MbcUri  !== null) {
            var result = JSON.parse(MbcUri.replace(/\(|\)|\;/g, ''));
            var streamUrl = result.AACLiveURL;
            response = {
              uri: streamUrl,
              service: self.serviceName,
              name: self.radioStations.mbc[channel].title,
              title: self.radioStations.mbc[channel].title,
              type: 'track',
              trackType: self.getRadioI18nString('PLUGIN_NAME'),
              radioType: station,
              albumart: '/albumart?sourceicon=music_service/personal_radio/mbc.svg'
            };
          }
          defer.resolve(response);
        });
      break;

    case 'weblinn':
      response = {
        uri: self.radioStations.linn[channel].url,
        service: self.serviceName,
        name: self.radioStations.linn[channel].title,
        type: 'track',
        trackType: self.getRadioI18nString('PLUGIN_NAME'),
        radioType: station,
        albumart: '/albumart?sourceicon=music_service/personal_radio/linn.svg'
      };
      defer.resolve(response);
      break;

    default:
      defer.resolve();
  }

  return defer.promise;
};

// Stream and resource functions for Radio -----------------------------------

ControllerPersonalRadio.prototype.getSecretKey = function () {
  var self = this;
  var defer = libQ.defer();

  var Request = unirest.get('https://raw.githubusercontent.com/ChrisPanda/volumio-kradio-key/master/radiokey.json');
  Request.end (function (response) {
    if (response.status === 200) {
      var result = JSON.parse(response.body);

      if (result !== undefined) {
        defer.resolve(result);
      } else {
        self.commandRouter.pushToastMessage('error',
            self.getRadioI18nString('PLUGIN_NAME'),
            self.getRadioI18nString('ERROR_SECRET_KEY'));

        defer.resolve(null);
      }
    } else {
      self.commandRouter.pushToastMessage('error',
          self.getRadioI18nString('PLUGIN_NAME'),
          self.getRadioI18nString('ERROR_SECRET_KEY_SERVER'));
      defer.resolve(null);
    }
  });

  return defer.promise;
};

ControllerPersonalRadio.prototype.getStreamUrl = function (station, url, query) {
  var self = this;
  var defer = libQ.defer();

  var Request = unirest.get(url);
  Request
    .query(query)
    .end(function (response) {
      if (response.status === 200)
        defer.resolve(response.body);
      else {
        defer.resolve(null);
        var errorMessage = self.getRadioI18nString('ERROR_STREAM_URL');
        errorMessage.replace('{0}', station);

        self.commandRouter.pushToastMessage('error',
            self.getRadioI18nString('PLUGIN_NAME'), errorMessage);
      }
    });

  return defer.promise;
};

ControllerPersonalRadio.prototype.getKbsStreamUrl = function (channel) {
  var self = this;
  var defer = libQ.defer();
  var userId;

  userId = Math.random().toString(36).substring(2, 6) + Math.random().toString(36).substring(2, 6);

  var Request = unirest.get(self.baseKbsStreamUrl);
  Request.query({
      id: userId,
      channel: channel
  }).end(function (response) {
    if (response.status === 200) {
      var result = response.body.split("\n");
      var retCode = parseInt(result[0]);
      var streamUrl = result[1];

      if (retCode === 0) {
        defer.resolve(streamUrl);
      }
      else {
        self.commandRouter.pushToastMessage('error',
            self.getRadioI18nString('PLUGIN_NAME'),
            self.getRadioI18nString('ERROR_KBS_URL'));

        defer.resolve(null);
      }
    } else {
      defer.resolve(null);
    }
  });
  return defer.promise;
};

ControllerPersonalRadio.prototype.getSbsStreamUrl = function (channel) {
  var self = this;
  var defer = libQ.defer();

  return defer.promise;
};

ControllerPersonalRadio.prototype.getMbcStreamUrl = function (channel) {
  var self = this;
  var defer = libQ.defer();

  var Request = unirest.get(self.baseMbcStreamUrl);
  Request.query({
      channel: self.radioStations.mbc[channel].channel,
      agent: 'agent',
      protocol: 'RTMP'
  })
  .end(function (response) {
    if (response.status === 200) {
      var result = JSON.parse(response.body.replace(/\(|\)|\;/g,''));
      var streamUrl = result.AACLiveURL;
      if (streamUrl !== undefined) {
          defer.resolve(streamUrl);
      }
      else {
        self.commandRouter.pushToastMessage('error',
            self.getRadioI18nString('PLUGIN_NAME'),
            self.getRadioI18nString('ERROR_MBC_URL'));

        defer.resolve(null);
      }
    } else {
      self.commandRouter.pushToastMessage('error',
          self.getRadioI18nString('PLUGIN_NAME'),
          self.getRadioI18nString('ERROR_MBC_URL'));
      defer.resolve(null);
    }
  });
  return defer.promise;
};

ControllerPersonalRadio.prototype.addRadioResource = function() {
  var self=this;

  var radioResource = fs.readJsonSync(__dirname+'/radio_stations.json');

  self.rootRadios = radioResource.rootStations;
  self.baseNavigation = radioResource.baseNavigation;
  self.radioStations = radioResource.stations;

  // i18n resource localization
  self.radioStations.kbs[2].title =  self.getRadioI18nString('KBS1_RADIO');
  self.radioStations.kbs[3].title =  self.getRadioI18nString('KBS2_RADIO');
  self.radioStations.kbs[4].title =  self.getRadioI18nString('KBS3_RADIO');
  self.radioStations.kbs[6].title =  self.getRadioI18nString('KBS_UNION');
  self.radioStations.kbs[7].title =  self.getRadioI18nString('KBS_WORLD');
  self.radioStations.mbc[0].title =  self.getRadioI18nString('MBC_STANDARD');
  self.radioStations.mbc[1].title =  self.getRadioI18nString('MBC_FM4U');
  self.radioStations.mbc[2].title =  self.getRadioI18nString('MBC_CHANNEL_M');
  self.radioStations.sbs[0].title =  self.getRadioI18nString('SBS_POWER_FM');
  self.radioStations.sbs[1].title =  self.getRadioI18nString('SBS_LOVE_FM');
  self.radioStations.sbs[2].title =  self.getRadioI18nString('SBS_INTERNET_RADIO');

  // KBS, MBC Radio Streaming server Preparing
  var KbsCipherText = radioResource.encUri.kbs;
  var MbcCipherText = radioResource.encUri.mbc;
  var SbsCipherText = radioResource.encUri.sbs;

  self.getSecretKey().then(function(response) {
    var secretKey = response.secretKey;
    var algorithm = response.algorithm;

    var decipherKBS = crypto.createDecipher(algorithm, secretKey);
    self.baseKbsStreamUrl = decipherKBS.update(KbsCipherText, 'hex', 'utf8');
    self.baseKbsStreamUrl += decipherKBS.final('utf8');

    var decipherMBC = crypto.createDecipher(algorithm, secretKey);
    self.baseMbcStreamUrl = decipherMBC.update(MbcCipherText, 'hex', 'utf8');
    self.baseMbcStreamUrl += decipherMBC.final('utf8');

    var decipherMBC = crypto.createDecipher(algorithm, secretKey);
    self.baseSbsStreamUrl = decipherMBC.update(SbsCipherText, 'hex', 'utf8');
    self.baseSbsStreamUrl += decipherMBC.final('utf8');
  });
};

ControllerPersonalRadio.prototype.loadRadioI18nStrings = function () {
  var self=this;

  try {
    var language_code = this.commandRouter.sharedVars.get('language_code');
    self.i18nStrings=fs.readJsonSync(__dirname+'/i18n/strings_'+language_code+".json");
  } catch(e) {
    self.i18nStrings=fs.readJsonSync(__dirname+'/i18n/strings_en.json');
  }

  self.i18nStringsDefaults=fs.readJsonSync(__dirname+'/i18n/strings_en.json');
};

ControllerPersonalRadio.prototype.getRadioI18nString = function (key) {
  var self=this;

  if (self.i18nStrings[key] !== undefined)
    return self.i18nStrings[key];
  else
    return self.i18nStringsDefaults[key];
};