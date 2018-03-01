'use strict';

// This Volumio plugin provides Korean radios (SBS, KBS, MBC) and Linn radio.

var libQ = require('kew');
var fs = require('fs-extra');
var config = require('v-conf');
var unirest = require('unirest');
var crypto = require('crypto');
var htmlToJson = require('html-to-json');
var RssParser = require('rss-parser');

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
  self.sbsProtocol =  self.config.get('sbsProtocol');
  self.mbcProtocol =  self.config.get('mbcProtocol');
  self.radioMode = true;

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

ControllerPersonalRadio.prototype.setConf = function(conf) {
  var self = this;

  fs.writeJsonSync(self.configFile, JSON.stringify(conf));
};

ControllerPersonalRadio.prototype.getUIConfig = function() {
  var self = this;
  var defer = libQ.defer();
  var lang_code = this.commandRouter.sharedVars.get('language_code');

  self.getConf(this.configFile);
  self.commandRouter.i18nJson(__dirname+'/i18n/strings_' + lang_code + '.json',
      __dirname + '/i18n/strings_en.json',
      __dirname + '/UIConfig.json')
  .then(function(uiconf)
  {
    uiconf.sections[0].content[0].value = self.config.get('sbsProtocol');
    uiconf.sections[0].content[1].value = self.config.get('mbcProtocol');

    defer.resolve(uiconf);
  })
  .fail(function()
  {
    defer.reject(new Error());
  });

  return defer.promise;
};

ControllerPersonalRadio.prototype.setUIConfig = function(data)
{
  var self = this;

  var uiconf=fs.readJsonSync(__dirname+'/UIConfig.json');

  return libQ.resolve();
};

ControllerPersonalRadio.prototype.updateConfig = function (data) {
  var self = this;
  var defer = libQ.defer();
  var configUpdated = false;

  if (self.config.get('sbsProtocol') != data['sbsProtocol']) {
    self.config.set('sbsProtocol', data['sbsProtocol']);
    self.sbsProtocol = data['sbsProtocol'];
    configUpdated = true;
  }

  if (self.config.get('mbcProtocol') != data['mbcProtocol']) {
    self.config.set('mbcProtocol', data['mbcProtocol']);
    self.mbcProtocol = data['mbcProtocol'];
    configUpdated = true;
  }

  if(configUpdated) {
    var responseData = {
      title: self.getRadioI18nString('PLUGIN_NAME'),
      message: self.getRadioI18nString('STOP_RADIO_STATION'),
      size: 'md',
      buttons: [{
        name: 'Close',
        class: 'btn btn-info'
      }]
    };

    self.commandRouter.broadcastMessage("openModal", responseData);
  }

  return defer.promise;
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
  var defer = libQ.defer();
  var response;

  //self.logger.info("ControllerPersonalRadio::handleBrowseUri:"+curUri);

  if (curUri.startsWith('kradio')) {
    if (curUri === 'kradio') {
      defer.resolve(self.getRootContent());
    }
    else if (curUri === 'kradio/kbs') {
      defer.resolve(self.getRadioContent('kbs'));
    }
    else if (curUri === 'kradio/sbs') {
      defer.resolve(self.getRadioContent('sbs'));
    }
    else if (curUri === 'kradio/mbc') {
      defer.resolve(self.getRadioContent('mbc'));
    }
    else if (curUri === 'kradio/linn') {
      defer.resolve(self.getRadioContent('linn'));
    }
    else if (curUri === 'kradio/bbc') {
      defer.resolve(self.getRadioContent('bbc'));
    }
    else {
      var uriParts = curUri.split('/');

      if ((uriParts.length === 3) && (uriParts[1] === 'bbc'))
        self.getPodcastBBC(uriParts[2]).then(function (result) {
          defer.resolve(result);
        });
      else if ((uriParts.length === 4) && (uriParts[1] === 'bbc'))
        self.getPodcastArticle(uriParts[2], uriParts[3]).then(function (result) {
          defer.resolve(result);
        });
      else {
        return defer.reject(new Error());
      }
    }
  }

  return defer.promise;
};

ControllerPersonalRadio.prototype.getPodcastBBC = function(uri) {
  var self = this;
  var defer = libQ.defer();

  var streamUrl = 'http://www.bbc.co.uk/podcasts/' + uri;
  self.logger.info("ControllerPersonalRadio::podcast:"+ streamUrl);

  unirest
  .get(streamUrl)
  .end(function (response) {
    if (response.status === 200) {
      htmlToJson.parse(response.body, ['a[data-istats-package]',
        {
          'uri': function ($a) {
            return $a.attr('href');
          },
          'title': function ($a) {
            return $a.find('h3[class]').text().trim();
          },
          'img': function ($a) {
            return $a.find('img[aria-hidden]').attr('src');
          }
        }
      ])
      .done(function (parseResult) {
        self.bbcNavigation.navigation.prev.uri = 'kradio/bbc';
        var response = self.bbcNavigation;
        response.navigation.lists[0].items = [];
        for (var item in parseResult) {
          var channel = {
            service: self.serviceName,
            type: 'folder',
            title: parseResult[item].title,
            icon: 'fa fa-folder-open-o',
            uri: 'kradio/bbc/' + uri + '/' + parseResult[item].uri.match(/programmes\/(.*)\/episodes/)[1]
          };
          response.navigation.lists[0].items.push(channel);
        }
        //self.logger.info("ControllerPersonalRadio::getPodcastBBC:RESULT:"+ JSON.stringify(response));

        defer.resolve(response);
      });

    } else {
      defer.resolve(null);
    }
  });

  return defer.promise;
};

ControllerPersonalRadio.prototype.getPodcastArticle = function(channel, uri) {
  var self = this;
  var defer = libQ.defer();

  self.logger.info("ControllerPersonalRadio::podcast:post:"+ uri);
  var rssParser = new RssParser({
    customFields: {
      channel: ['image'],
      item: [
        'enclosure',
        ['ppg:enclosureLegacy', 'enclosureLegacy'],
        ['ppg:enclosureSecure', 'enclosureSecure']
      ]
    }
  });

  rssParser.parseURL('http://podcasts.files.bbci.co.uk/' + uri + '.rss',
    function (err, feed) {

      self.bbcNavigation.navigation.prev.uri = 'kradio/bbc/' + channel;
      var response = self.bbcNavigation;
      response.navigation.lists[0].items = [];

      self.podcastImage = feed.itunes.image;
      //self.logger.info("ControllerPersonalRadio::PODCAST:IMAGE:"+self.podcastImage);

      feed.items.forEach(function (entry) {
        //console.log(entry.title + ':' + entry.enclosureSecure.$.url);
        var channel = {
          service: self.serviceName,
          type: 'mywebradio',
          title: entry.title,
          icon: 'fa fa-music',
          uri: 'webbbc/0/' + entry.enclosureSecure.$.url
        };
        response.navigation.lists[0].items.push(channel);
      });
      //self.logger.info("ControllerPersonalRadio::PodcastArticle:RESULT:"+ JSON.stringify(response));
      defer.resolve(response);
    });

  return defer.promise;
};

ControllerPersonalRadio.prototype.getRootContent = function() {
  var self=this;
  var response;
  var defer = libQ.defer();

  response = self.rootNavigation;
  response.navigation.lists[0].items = [];
  for (var key in self.rootStations) {
      var radio = {
        service: self.serviceName,
        type: 'folder',
        title: self.rootStations[key].title,
        icon: 'fa fa-folder-open-o',
        uri: self.rootStations[key].uri
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
      break;
    case 'bbc':
      radioStation = self.radioStations.bbc;
  }

  response = self.radioNavigation;
  response.navigation.lists[0].items = [];
  for (var i in radioStation) {
    var channel = {
      service: self.serviceName,
      title: radioStation[i].title,
      uri: radioStation[i].uri
    };
    if (station === 'bbc') {
      channel["type"] = 'folder';
      channel["icon"] = 'fa fa-folder-open-o';
    }
    else {
      channel["type"] = 'mywebradio';
      channel["icon"] = 'fa fa-music';
    }
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
            self.radioMode = true;
            return self.mpdPlugin.getState().then(function (state) {
                return self.commandRouter.stateMachine.syncState(state, self.serviceName);
            });
            break;
          default:
            self.radioMode = false;
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
  if (self.radioMode === true) {
    return self.mpdPlugin.stop().then(function () {
      return self.mpdPlugin.getState().then(function (state) {
        return self.commandRouter.stateMachine.syncState(state,
            self.serviceName);
      });
    });
  }
  else
    return self.mpdPlugin.sendMpdCommand('stop',[]);
};

ControllerPersonalRadio.prototype.pause = function() {
  var self = this;

  if (self.radioMode === true) {
    return self.mpdPlugin.pause().then(function () {
      return self.mpdPlugin.getState().then(function (state) {
        return self.commandRouter.stateMachine.syncState(state,
            self.serviceName);
      });
    });
  }
  else
    return self.mpdPlugin.sendMpdCommand('pause',[]);
};

ControllerPersonalRadio.prototype.resume = function() {
  var self = this;
  if (self.radioMode === true) {
    return self.mpdPlugin.resume().then(function () {
      return self.mpdPlugin.getState().then(function (state) {
        return self.commandRouter.stateMachine.syncState(state,
            self.serviceName);
      });
    });
  }
  else
    return self.mpdPlugin.sendMpdCommand('play',[]);
};

ControllerPersonalRadio.prototype.explodeUri = function (uri) {
  var self = this;
  var defer = libQ.defer();
  var uris = uri.split("/", 2);
  var channel = parseInt(uris[1]);
  var response;
  var query;
  var station;

  self.logger.info("ControllerPersonalRadio::explodeUri:"+uri);
  station = uris[0].substring(3);
  response = {
      service: self.serviceName,
      type: 'track',
      trackType: self.getRadioI18nString('PLUGIN_NAME'),
      radioType: station,
      albumart: '/albumart?sourceicon=music_service/personal_radio/'+station+'.svg'
  };

  switch (uris[0]) {
    case 'webkbs':
      var userId = Math.random().toString(36).substring(2, 6) +
                   Math.random().toString(36).substring(2, 6);
      query = {
        id: userId,
        channel: channel+1
      };
      self.getStreamUrl(station, self.baseKbsStreamUrl, query)
        .then(function (responseUrl) {
          if (responseUrl  !== null) {
            var result = responseUrl.split("\n");
            var retCode = parseInt(result[0]);
            var streamUrl;
            if (retCode === 0)
              streamUrl = result[1];
            else {
              streamUrl = null;
              self.errorToast(station, 'INCORRECT_RESPONSE');
            }

            response["uri"] = streamUrl;
            response["name"] = self.radioStations.kbs[channel].title;
            response["title"] = self.radioStations.kbs[channel].title;
          }
          defer.resolve(response);
        });
      break;

    case 'websbs':
      var device;
      if(self.sbsProtocol === true)
        device = 'mobile';
      else
        device = 'pc';

      var baseSbsStreamUrl = self.baseSbsStreamUrl + self.radioStations.sbs[channel].channel;
      self.getStreamUrl(station, baseSbsStreamUrl, {device: device})
        .then(function (responseUrl) {
          if (responseUrl  !== null) {
            var decipher = crypto.createDecipheriv(self.sbsAlgorithm, self.sbsKey, "");
            var streamUrl = decipher.update(responseUrl, 'base64', 'utf8');
            streamUrl += decipher.final('utf8');

            response["uri"] = streamUrl;
            response["name"] = self.radioStations.sbs[channel].title;
            response["title"] = self.radioStations.sbs[channel].title;
          }
          defer.resolve(response);
        });
      break;

    case 'webmbc':
      var agent, protocol;
      if(self.mbcProtocol === true) {
        agent = 'android';
        protocol = 'M3U8';
      }
      else {
        agent = 'pc';
        protocol = 'RTMP';
      }

      query = {
        channel: self.radioStations.mbc[channel].channel,
        agent: agent,
        protocol: protocol
      };
      self.getStreamUrl(station, self.baseMbcStreamUrl, query)
        .then(function (responseUrl) {
          if (responseUrl  !== null) {
            var result = JSON.parse(responseUrl.replace(/\(|\)|\;/g, ''));
            var streamUrl = result.AACLiveURL;
            if (streamUrl === undefined) {
              streamUrl = null;
              self.errorToast(station, 'INCORRECT_RESPONSE');
            }

            response["uri"] = streamUrl;
            response["name"] = self.radioStations.mbc[channel].title;
            response["title"] = self.radioStations.mbc[channel].title;
          }
          defer.resolve(response);
        });
      break;

    case 'weblinn':
      response["uri"] = self.radioStations.linn[channel].url;
      response["name"] = self.radioStations.linn[channel].title;

      defer.resolve(response);
      break;

    case 'webbbc':
      response["uri"] = uri.match(/webbbc\/.\/(.*)/)[1];
      response["name"] = 'BBC podcast';
      response["albumart"] = self.podcastImage;
      defer.resolve(response);
      break;

    default:
      defer.resolve();
  }

  return defer.promise;
};

// Stream and resource functions for Radio -----------------------------------

ControllerPersonalRadio.prototype.getSecretKey = function (radioKeyUrl) {
  var self = this;
  var defer = libQ.defer();

  var Request = unirest.get(radioKeyUrl);
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
        self.errorToast(station, 'ERROR_STREAM_SERVER');
      }
    });

  return defer.promise;
};

ControllerPersonalRadio.prototype.addRadioResource = function() {
  var self=this;

  var radioResource = fs.readJsonSync(__dirname+'/radio_stations.json');
  var baseNavigation = radioResource.baseNavigation;

  self.rootStations = radioResource.rootStations;
  self.radioStations = radioResource.stations;
  self.rootNavigation = JSON.parse(JSON.stringify(baseNavigation));
  self.radioNavigation = JSON.parse(JSON.stringify(baseNavigation));
  self.bbcNavigation = JSON.parse(JSON.stringify(baseNavigation));
  self.rootNavigation.navigation.prev.uri = '/';

  // i18n resource localization
  self.rootStations.kbs.title =  self.getRadioI18nString('KBS');
  self.rootStations.sbs.title =  self.getRadioI18nString('SBS');
  self.rootStations.mbc.title =  self.getRadioI18nString('MBC');

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

  // Korean radio streaming server preparing
  self.getSecretKey(radioResource.encodedRadio.radioKeyUrl).then(function(response) {
    var secretKey = response.secretKey;
    var algorithm = response.algorithm;
    self.sbsKey = (new Buffer(response.stationKey, 'base64')).toString('ascii');
    self.sbsAlgorithm = response.algorithm2;

    self.baseKbsStreamUrl = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.kbs);
    self.baseMbcStreamUrl = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.mbc);
    self.baseSbsStreamUrl = self.decodeStreamUrl(algorithm, secretKey, radioResource.encodedRadio.sbs);
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

ControllerPersonalRadio.prototype.decodeStreamUrl =
    function (algorithm, secretKey, encodedUri) {

  var decipherObj = crypto.createDecipher(algorithm, secretKey);
  var streamUrl = decipherObj.update(encodedUri, 'hex', 'utf8');
  streamUrl += decipherObj.final('utf8');

  return streamUrl;
};

ControllerPersonalRadio.prototype.errorToast = function (station, msg) {
  var errorMessage = self.getRadioI18nString(msg);
  errorMessage.replace('{0}', station.toUpperCase());
  self.commandRouter.pushToastMessage('error',
      self.getRadioI18nString('PLUGIN_NAME'), errorMessage);
};


