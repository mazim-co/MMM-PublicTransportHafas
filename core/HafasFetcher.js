"use strict";

const moment = require("moment");
const createClient = require("hafas-client");
const arrayDiff = require("arr-diff");
const pjson = require("../package.json");

module.exports = class HafasFetcher {
  /**
   *
   * @param {object} config The configuration used for this fetcher. It has the following format:
   *        config = {
   *          identifier: *a string identifying this fetcher, must be unique for all instances of the module*
   *          hafasProfile: *a valid hafas-client profile name*,
   *          stationID: *a valid station id*,
   *          timeToStation: *an integer describing how long it takes to get to the station (in minutes)*,
   *          timeInFuture: *an integer describing how far in the future the departure can lie*
   *          direction: *an array of station ids*,
   *          ignoredLines: *an array of line names which are to be ignored*,
   *          excludedTransportationTypes: *an array of product names which are not to be shown*,
   *          maxReachableDepartures: *an integer describing how many departures should be fetched*,
   *          maxUnreachableDepartures: *an integer describing how many unreachable departures should be fetched*
   *        }
   */
  constructor(config) {
    this.leadTime = 20; // minutes
    this.config = config;
    const profile = require("hafas-client/p/" + this.config.hafasProfile);
    this.hafasClient = createClient(
      profile,
      "MMM-PublicTransportHafas v" + pjson.version
    );

    // types given by the api
    this.possibleTypes = [
      "bus",
      "ferry",
      "express",
      "national",
      "nationalExpress",
      "regional",
      "suburban",
      "subway",
      "tram",
      "taxi",
      // for SVV
      "bahn-s-bahn",
      "u-bahn",
      "strassenbahn",
      "fernbus",
      "regionalbus",
      "stadtbus",
      "seilbahn-zahnradbahn",
      "schiff",
      // for SBB
      "express-train",
      "international-train",
      "interregional-train",
      "regional-express-train",
      "watercraft",
      "suburban-train",
      "bus-taxi",
      "gondola",
      "car-train"
    ];

    this.config.includedTransportationTypes = arrayDiff(
      this.possibleTypes,
      this.config.excludedTransportationTypes
    );
  }

  getIdentifier() {
    return this.config.identifier;
  }

  getStationID() {
    return this.config.stationID;
  }

  fetchDepartures() {
    let options = {
      when: this.getDepartureTime(),
      direction: this.config.direction,
      duration: this.getTimeInFuture()
    };

    return this.hafasClient
      .departures(this.config.stationID, options)
      .then((departures) => {
        let maxElements =
          this.config.maxReachableDepartures +
          this.config.maxUnreachableDepartures;
        let filteredDepartures = this.filterByTransportationTypes(departures);
        filteredDepartures = this.filterByIgnoredLines(filteredDepartures);
        filteredDepartures =
          this.departuresMarkedWithReachability(filteredDepartures);
        filteredDepartures =
          this.departuresRemovedSurplusUnreachableDepartures(
            filteredDepartures
          );
        filteredDepartures = filteredDepartures.slice(0, maxElements);
        return filteredDepartures;
      })
      .catch((e) => {
        throw e;
      });
  }

  getDepartureTime() {
    let departureTime = this.getReachableTime();

    if (this.config.maxUnreachableDepartures > 0) {
      departureTime = moment(departureTime).subtract(this.leadTime, "minutes");
    }

    return departureTime;
  }

  getReachableTime() {
    return moment().add(this.config.timeToStation, "minutes");
  }

  getTimeInFuture() {
    let timeInFuture = this.config.timeInFuture;
    if (this.config.maxUnreachableDepartures > 0) {
      timeInFuture = timeInFuture + this.leadTime;
    }

    return timeInFuture;
  }

  filterByTransportationTypes(departures) {
    return departures.filter((departure) => {
      let product = departure.line.product;
      let index = this.config.includedTransportationTypes.indexOf(product);

      return index !== -1;
    });
  }

  filterByIgnoredLines(departures) {
    return departures.filter((departure) => {
      let line = departure.line.name;
      let index = this.config.ignoredLines.indexOf(line);

      return index === -1;
    });
  }

  departuresMarkedWithReachability(departures) {
    return departures.map((departure) => {
      departure.isReachable = this.isReachable(departure);
      return departure;
    });
  }

  departuresRemovedSurplusUnreachableDepartures(departures) {
    // Get all unreachable departures
    let unreachableDepartures = departures.filter(
      (departure) => !departure.isReachable
    );

    // Adjust lead time for next request
    this.adjustLeadTime(unreachableDepartures);

    // Remove surplus unreachable departures
    unreachableDepartures = unreachableDepartures.slice(
      -this.config.maxUnreachableDepartures
    );

    // Get all reachable departures
    let reachableDepartures = departures.filter(
      (departure) => departure.isReachable
    );

    // Merge unreachable and reachable departures
    let result = [].concat(unreachableDepartures, reachableDepartures);

    return result;
  }

  adjustLeadTime(unreachableDepartures) {
    /**
     * This method dynamically adjusts the lead time. This is only relevant if
     * 'this.config.maxUnreachableDepartures' is greater than 0. The dynamic
     * adjustment is useful because there are stops where are many departures
     * in the lead time and some where are very few.
     */
    if (unreachableDepartures.length > this.config.maxUnreachableDepartures) {
      this.leadTime = Math.round(this.leadTime / 2) + 1;
    } else if (this.leadTime <= 45) {
      this.leadTime = this.leadTime + 5;
    }
  }

  isReachable(departure) {
    return moment(departure.when).isSameOrAfter(
      moment(this.getReachableTime())
    );
  }
};
