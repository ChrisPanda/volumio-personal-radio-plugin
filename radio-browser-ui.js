'use strict';

const libQ = require('kew');

module.exports = RadioBrowserUi;

function RadioBrowserUi() {

    const init = function(context) {
        this.context = context;
        this.radioCore = context.radioCore
    }

    const getRootContent = function() {
        let self=this;
        let response;

        response = self.radioCore.rootNavigation;
        response.navigation.lists[0].items = [];
        for (let key in self.radioCore.rootStations) {
            let radio = {
                service: self.context.serviceName,
                type: 'folder',
                title: self.radioCore.rootStations[key].title,
                uri: self.radioCore.rootStations[key].uri,
                albumart: '/albumart?sourceicon=music_service/personal_radio/logos/'+key+'.png'
            };
            response.navigation.lists[0].items.push(radio);
        }

        return libQ.resolve(response);
    }

    const getRadioContent = function(station) {
        let self=this;
        let response;
        let radioStation;

        switch (station) {
            case 'kbs':
                radioStation = self.radioCore.radioStations.kbs;
                break;
            case 'sbs':
                radioStation = self.radioCore.radioStations.sbs;
                break;
            case 'mbc':
                radioStation = self.radioCore.radioStations.mbc;
                break;
            case 'linn':
                radioStation = self.radioCore.radioStations.linn;
        }

        response = self.radioCore.radioNavigation;
        response.navigation.lists[0].items = [];
        for (let i in radioStation) {
            let channel = {
                service: self.context.serviceName,
                type: 'song',
                title: radioStation[i].title,
                artist: '',
                album: '',
                uri: radioStation[i].uri,
                albumart: '/albumart?sourceicon=music_service/personal_radio/logos/'+station+i+'.png'
            };
            response.navigation.lists[0].items.push(channel);
        }

        return libQ.resolve(response);
    };

    return {
        init: init,
        getRootContent: getRootContent,
        getRadioContent: getRadioContent
    }
}