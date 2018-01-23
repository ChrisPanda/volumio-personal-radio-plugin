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

  self.logger.info("PersonalRadio:CONFIG:"+JSON.stringify(self.config.get("radioStations")));

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


ControllerPersonalRadio.prototype.getKbsContent = function() {
  var self=this;
  var response;
  var defer = libQ.defer();

  response = JSON.parse(JSON.stringify(self.baseNavigation));
  for (var i in self.kbs) {
    var channel = {
      service: self.serviceName,
      type: 'mywebradio',
      title: self.kbs[i].title,
      artist: '',
      album: '',
      icon: 'fa fa-music',
      uri: 'webkbs/'+ i
    };
    response.navigation.lists[0].items.push(channel);
  }
  defer.resolve(response);

  return defer.promise;
};

ControllerPersonalRadio.prototype.getSbsContent = function() {
  var self=this;
  var response;
  var defer = libQ.defer();

  response = JSON.parse(JSON.stringify(self.baseNavigation));
  for (var i in self.sbs) {
      var channel = {
          service: self.serviceName,
          type: 'mywebradio',
          title: self.sbs[i].title,
          artist: '',
          album: '',
          icon: 'fa fa-music',
          uri: 'websbs/'+ i
      };
      response.navigation.lists[0].items.push(channel);
  }
  defer.resolve(response);

  return defer.promise;
};

ControllerPersonalRadio.prototype.getMbcContent = function() {
  var self=this;
  var response;
  var defer = libQ.defer();

  response = JSON.parse(JSON.stringify(self.baseNavigation));
  for (var k in self.mbc) {
    var channel = {
      service: self.serviceName,
      type: 'mywebradio',
      title: self.mbc[k].title,
      artist: '',
      album: '',
      icon: 'fa fa-music',
      uri: 'webmbc/'+ k
    };
    response.navigation.lists[0].items.push(channel);
  }
  defer.resolve(response);

  return defer.promise;
};

ControllerPersonalRadio.prototype.getLinnContent = function() {
  var self = this;
  var response;
  var defer = libQ.defer();

  response = JSON.parse(JSON.stringify(self.baseNavigation));
  for (var j in self.linn) {
    var channel = {
      service: self.serviceName,
      type: 'mywebradio',
      title: self.linn[j].title,
      artist: '',
      album: '',
      icon: 'fa fa-music',
      uri: 'weblinn/'+ j
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

  var baseResponse = {
      service: self.serviceName,
      type: 'track',
      trackType: self.getRadioI18nString('PLUGIN_NAME')
  };

  switch (uris[0]) {
    case 'webkbs':
      self.getKbsStreamUrl(channel+1).then(function (kbsUri) {
        response = {
          uri: kbsUri,
          service: self.serviceName,
          name: self.radioStations.kbs[channel].title,
          title: self.radioStations.kbs[channel].title,
          type: 'track',
          trackType: self.getRadioI18nString('PLUGIN_NAME'),
          radioType: 'kbs',
          albumart: '/albumart?sourceicon=music_service/personal_radio/kbs.svg'
        };
        defer.resolve(response);
      });
      break;

    case 'websbs':
      self.getSbsStreamUrl(channel).then(function (sbsUri) {
        response = {
          uri: sbsUri,
          service: self.serviceName,
          name: self.radioStations.sbs[channel].title,
          title: self.radioStations.sbs[channel].title,
          type: 'track',
          trackType: self.getRadioI18nString('PLUGIN_NAME'),
          radioType: 'sbs',
          albumart: '/albumart?sourceicon=music_service/personal_radio/kbs.svg'
        };
        defer.resolve(response);
      });
      break;

    case 'webmbc':
      self.getMbcStreamUrl(channel).then(function (MbcUri) {
        response = {
          uri: MbcUri,
          service: self.serviceName,
          name: self.radioStations.mbc[channel].title,
          title: self.radioStations.mbc[channel].title,
          type: 'track',
          trackType: self.getRadioI18nString('PLUGIN_NAME'),
          radioType: 'mbc',
          albumart: '/albumart?sourceicon=music_service/personal_radio/mbc.svg'
        };
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
        radioType: 'linn',
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

  self.rootRadios = [
      {
          title: 'KBS',
          uri: 'kradio/kbs'
      },
      {
          title: 'SBS',
          uri: 'kradio/sbs'
      },
      {
          title: 'MBC',
          uri: 'kradio/mbc'
      },
      {
          title: 'Linn',
          uri: 'kradio/linn'
      }
  ];

  self.baseNavigation = {
    "navigation": {
      "lists": [
        {
          "availableListViews": [
            'list'
          ],
          "items": [
          ]
        }
      ],
      "prev": {
        "uri": 'kradio'
      }
    }
  };

  // Linn Radio Resource Preparing
  self.radioStations =
    {
      linn: [
        {
          title: self.config.get("linnJazzName"),
          uri: 'weblinn/0',
          url: self.config.get("linnJazzUrl")
        },
        {
          title: self.config.get("linnRadioName"),
          uri: 'weblinn/1',
          url: self.config.get("linnRadioUrl")
        },
        {
          title: self.config.get("linnClassicName"),
          uri: 'weblinn/2',
          url: self.config.get("linnClassicUrl")
        }
      ],
      kbs: [
        {
          title: 'KBS1 FM',
          uri: 'webkbs/0'
        },
        {
          title: 'KBS2 FM',
          uri: 'webkbs/1'
        },
        {
          title: self.getRadioI18nString('KBS1_RADIO'),
          uri: 'webkbs/2'
        },
        {
          title: self.getRadioI18nString('KBS2_RADIO'),
          uri: 'webkbs/3'
        },
        {
          title: self.getRadioI18nString('KBS3_RADIO'),
          uri: 'webkbs/4'
        },
        {
          title: 'KBS DMB',
          uri: 'webkbs/5'
        },
        {
          title: self.getRadioI18nString('KBS_UNION'),
          uri: 'webkbs/6'
        },
        {
          title: self.getRadioI18nString('KBS_WORLD'),
          uri: 'webkbs/7'
        }
      ],
      mbc: [
        {
          title: self.getRadioI18nString('MBC_STANDARD'),
          uri: 'webmbc/0',
          channel: 'sfm'
        },
        {
          title: self.getRadioI18nString('MBC_FM4U'),
          uri: 'webmbc/1',
          channel: 'mfm'
        },
        {
          title: self.getRadioI18nString('MBC_CHANNEL_M'),
          uri: 'webmbc/2',
          channel: 'chm'
        }
      ],
      sbs: [
        {
          title: self.getRadioI18nString('SBS_POWER_FM'),
          uri: 'websbsc/0'
        },
        {
          title: self.getRadioI18nString('SBS_LOVE_FM'),
          uri: 'websbsc/1'
        },
        {
          title: self.getRadioI18nString('SBS_INTERNET_RADIO'),
          uri: 'websbsc/2'
        }
      ]
    };

  // KBS, MBC Radio Streaming server Preparing
  var KbsCipherText = 'cac4d4e664757c065285538ec8eed223e745230cf4c9fa5942b5db7a2d4b09fbddaf6892570dbc20b48a8a2091950f289a';
  var MbcCipherText = 'cac4d4e664757c0054855dd0cfedd823ed476f04a885f95d1b87e1680d4306fbfad247d45710ba3d';

  self.getSecretKey().then(function(response) {
    var secretKey = response.secretKey;
    var algorithm = response.algorithm;

    var decipherKBS = crypto.createDecipher(algorithm, secretKey);
    self.baseKbsStreamUrl = decipherKBS.update(KbsCipherText, 'hex', 'utf8');
    self.baseKbsStreamUrl += decipherKBS.final('utf8');

    var decipherMBC = crypto.createDecipher(algorithm, secretKey);
    self.baseMbcStreamUrl = decipherMBC.update(MbcCipherText, 'hex', 'utf8');
    self.baseMbcStreamUrl += decipherMBC.final('utf8');
  });
};

ControllerPersonalRadio.prototype.loadRadioI18nStrings = function () {
  var self=this;
  var language_code = this.commandRouter.sharedVars.get('language_code');

  self.i18nStrings=fs.readJsonSync(__dirname+'/i18n/strings_'+language_code+".json");
  self.i18nStringsDefaults=fs.readJsonSync(__dirname+'/i18n/strings_en.json');
};

ControllerPersonalRadio.prototype.getRadioI18nString = function (key) {
  var self=this;

  if (self.i18nStrings[key] !== undefined)
    return self.i18nStrings[key];
  else
    return self.i18nStringsDefaults[key];
};