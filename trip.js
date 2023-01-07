const btnClear = document.querySelector("#btnClear");
const btnDirections = document.querySelector("#btnDirections");
const txtStartAddress = document.querySelector("#txtStartAddress");
const txtDestinationAddress = document.querySelector("#txtDestinationAddress");
const txtMiles = document.querySelector("#txtMiles");
const txtLimit = document.querySelector("#txtLimit");
const txtDistance = document.querySelector("#txtDistance");
const rdbStationsNearestCoordinates = document.querySelector(
  "#rdbStationsNearestCoordinates"
);
const rdbStationsNearbyRoute = document.querySelector(
  "#rdbStationsNearbyRoute"
);
const instructions = document.querySelector("#instructions");

let map;
let mapMarkers = [];

let stationCount = 0;

// Event Listeners
btnDirections.addEventListener("click", getDirections);
btnClear.addEventListener("click", clickClearMarkers);

async function getStationData(lon, lat, radius, limit) {
  let data = {};
  try {
    let requestOptions = {
      method: "GET",
      redirect: "follow",
    };

    var params = {
      api_key: config.NREL_API_KEY,
      latitude: lat,
      longitude: lon,
      radius: radius, // miles
      status: "E",
      fuel_type: "ELEC",
      limit: limit, // 200 is the max limit
      access: "public",
    };

    let apiUrl =
      "https://developer.nrel.gov/api/alt-fuel-stations/v1/nearest.json?";
    for (let p in params) {
      apiUrl += `${p}=${params[p]}&`;
    }
    apiUrl = encodeURI(apiUrl.slice(0, -1));

    const response = await fetch(apiUrl, requestOptions);
    data = await response.json();
  } catch (err) {
    console.log(err);
  }

  return data.fuel_stations;
}

async function getStationDataNearRoute(route, distance, limit) {
  let data = {};
  try {
    // Use the waypoints to build a LINESTRING for NREL's nearby-route API
    // LINESTRING(-74.0 40.7, -87.63 41.87, -104.98 39.76)
    let lineString = "LINESTRING(";
    for (wp of route) {
      lineString += `${wp[0]} ${wp[1]}, `;
    }
    lineString = lineString.slice(0, -2) + ")";

    let requestOptions = {
      method: "GET",
      redirect: "follow",
    };

    var params = {
      api_key: config.NREL_API_KEY,
      route: lineString,
      distance: distance, // miles
      status: "E",
      fuel_type: "ELEC",
      limit: limit, // 0-200 or "all"
      access: "public",
    };

    let apiUrl =
      "https://developer.nrel.gov/api/alt-fuel-stations/v1/nearby-route.json?";
    for (let p in params) {
      apiUrl += `${p}=${params[p]}&`;
    }
    apiUrl = encodeURI(apiUrl.slice(0, -1));

    const response = await fetch(apiUrl, requestOptions);
    data = await response.json();
  } catch (err) {
    console.log(err);
  }
  return data.fuel_stations;
}

async function getLonLat(searchString) {
  try {
    let requestOptions = {
      method: "GET",
      redirect: "follow",
    };

    var params = {
      country: "us",
      proximity: "ip",
      limit: 1,
      types: "place,postcode,address",
      language: "en",
      access_token: config.MAPBOX_API_KEY,
    };

    let apiUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${searchString}.json?`;
    for (let p in params) {
      apiUrl += `${p}=${params[p]}&`;
    }
    apiUrl = encodeURI(apiUrl.slice(0, -1));

    const response = await fetch(apiUrl, requestOptions);
    const data = await response.json();
    return data.features[0].center; // In lon, lat format to match geoJSON
  } catch (err) {
    console.log(err);
  }
}

async function fetchDirections(start, destination) {
  try {
    let requestOptions = {
      method: "GET",
      redirect: "follow",
    };

    var params = {
      geometries: "geojson",
      steps: true,
      access_token: config.MAPBOX_API_KEY,
    };

    let apiUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${start[0]},${start[1]};${destination[0]},${destination[1]}?`;
    for (let p in params) {
      apiUrl += `${p}=${params[p]}&`;
    }
    apiUrl = encodeURI(apiUrl.slice(0, -1));

    const response = await fetch(apiUrl, requestOptions);
    const data = await response.json();

    return data;
  } catch (err) {
    console.log(err);
  }
}

async function getDirections(event) {
  event.preventDefault();

  stationCount = 0;

  const start = document.querySelector("#txtStartAddress").value.trim();
  const destination = document
    .querySelector("#txtDestinationAddress")
    .value.trim();

  if (start && destination) {
    const startCoordinates = await getLonLat(start);
    const destinationCoordinates = await getLonLat(destination);

    const directions = await fetchDirections(
      startCoordinates,
      destinationCoordinates
    );

    //console.log(directions);

    const route = directions.routes[0].geometry.coordinates;
    const geojson = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: route,
      },
    };

    // if the route already exists on the map, we'll reset it using setData
    if (map.getSource("route")) {
      map.getSource("route").setData(geojson);
    }
    // otherwise, we'll make a new request
    else {
      map.addLayer({
        id: "route",
        type: "line",
        source: {
          type: "geojson",
          data: geojson,
        },
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#3887be",
          "line-width": 5,
          "line-opacity": 0.75,
        },
      });
    }

    // Recenter the map
    map.fitBounds([startCoordinates, destinationCoordinates], {
      padding: { top: 50, bottom: 50, left: 50, right: 50 },
    });

    // Remove all markers
    await clearMarkers();

    const stopDistance = parseInt(txtMiles.value);
    const distanceFrom = parseInt(txtDistance.value);

    let waypoints = route;

    const stops = [];
    let totalDistance = 0;
    for (let i = 1; i < waypoints.length; i++) {
      const distance = await getDistanceAsCrowFlies(
        waypoints[i],
        waypoints[i - 1]
      );
      totalDistance += distance;
      if (totalDistance > stopDistance) {
        stops.push(i - 1);
        totalDistance = distance;
      }
    }
    //console.log(`Stops: ${stops}`);

    if (rdbStationsNearbyRoute.checked) {
      await setStationMarkersNearRoute(route, distanceFrom, txtLimit.value);
    }

    // Set the marker for the start
    await setMarker(`<b>${start}</b>`, startCoordinates, "home");

    for (let i = 0; i < stops.length; i++) {
      if (rdbStationsNearestCoordinates.checked) {
        await setStationMarkersNearCoordinates(
          ...waypoints[stops[i]],
          distanceFrom,
          25
        );
      }

      await setMarker(
        `<b>Stop #${i + 1}</b>`,
        waypoints[stops[i]],
        "mid-point"
      );
    }

    if (rdbStationsNearestCoordinates.checked) {
      // Drop charging stations near the end of the route
      await setStationMarkersNearCoordinates(
        ...destinationCoordinates,
        distanceFrom,
        10
      );
    }

    // Set the markers for the destination
    await setMarker(
      `<b>${destination}</b>`,
      destinationCoordinates,
      "end-point"
    );

    await printTextDirections(directions.routes[0], stopDistance, stops.length);
  }
}

async function printTextDirections(data, stopDistance, stops) {
  let tripInstructions = "";
  for (const step of data.legs[0].steps) {
    tripInstructions += `<li>${step.maneuver.instruction}</li>`;
  }
  const duration = new Date(data.duration * 1000).toISOString().slice(11, 19);
  const distance = data.distance / 1609; // Meters to miles
  instructions.innerHTML = `<p><strong>Trip Distance: ${distance.toFixed(
    0
  )} miles<br>Trip Duration: ${duration}<br>Recommended Stopping Distance: ${stopDistance.toFixed(
    0
  )} miles<br>Number of Stops: ${stops}<br>Number of Stations Found: ${stationCount}</strong></p><ol>${tripInstructions}</ol>`;
}

// Modified from https://stackoverflow.com/questions/27928/calculate-distance-between-two-latitude-longitude-points-haversine-formula
async function getDistanceAsCrowFlies(start, end) {
  var R = 3960; // Radius of the earth in miles
  var dLat = await deg2rad(end[1] - start[1]); // deg2rad below
  var dLon = await deg2rad(end[0] - start[0]);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(await deg2rad(start[1])) *
      Math.cos(await deg2rad(end[1])) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c; // Distance in miles
  return d;
}

async function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

async function setStationMarkers(stationData) {
  // Add markers to the map.
  for (const station of stationData) {
    let text = `<b>${station.station_name}</b><br>${station.street_address}<br>${station.city}, ${station.state} ${station.zip}`;

    if (station.ev_level1_evse_num) {
      text += `<br>Level 1 EVSE ports: ${station.ev_level1_evse_num}`;
    }

    if (station.ev_level2_evse_num) {
      text += `<br>Level 2 EVSE ports: ${station.ev_level2_evse_num}`;
    }

    if (station.ev_dc_fast_num) {
      text += `<br>DC Fast EVSE ports: ${station.ev_dc_fast_num}`;
    }

    if (station.ev_other_evse) {
      text += `<br>Other EVSE ports: ${station.ev_other_evse}`;
    }

    if (station.ev_connector_types) {
      text += `<br>EV Connector Types: ${station.ev_connector_types}`;
    }

    if (station.ev_pricing) {
      text += `<br>EV Pricing: ${station.ev_pricing}`;
    }

    setMarker(text, [station.longitude, station.latitude], "blue");
  }
}

async function setStationMarkersNearCoordinates(lon, lat, radius, limit) {
  const stationData = await getStationData(lon, lat, radius, limit);
  await setStationMarkers(stationData);

  stationCount += stationData.length;
}

async function setStationMarkersNearRoute(route, distance, limit) {
  const stationData = await getStationDataNearRoute(route, distance, limit);
  await setStationMarkers(stationData);

  stationCount += stationData.length;
}

async function setMarker(text, coordinates, image) {
  const el = document.createElement("div");
  el.className = "marker";
  el.style.backgroundImage = `url('${image}.png')`;
  el.style.width = `32px`;
  el.style.height = `32px`;
  el.style.backgroundSize = "100%";

  // Add markers to the map.
  const marker = new mapboxgl.Marker({ anchor: "bottom", element: el })
    .setLngLat(coordinates)
    .setPopup(
      new mapboxgl.Popup({
        closeButton: false,
      }).setHTML(`<b>${text}</b>`)
    );

  mapMarkers.push(marker);
  marker.addTo(map);
}

async function clearMarkers() {
  // Remove all markers
  if (mapMarkers !== null) {
    for (var i = mapMarkers.length - 1; i >= 0; i--) {
      mapMarkers[i].remove();
    }
    mapMarkers = [];
  }
}

async function clickClearMarkers(event) {
  event.preventDefault();
  await clearMarkers();
}

async function init() {
  const defaultStartCoordinates = await getLonLat(txtStartAddress.value.trim());

  mapboxgl.accessToken = config.MAPBOX_API_KEY;
  map = new mapboxgl.Map({
    container: "map", // container ID
    //style: "mapbox://styles/mapbox/streets-v11", // style URL
    style: "mapbox://styles/mapbox/navigation-night-v1",
    center: defaultStartCoordinates, // starting position [lng, lat]
    zoom: 11, // starting zoom
  });

  map.on("dblclick", (e) => {
    setStationMarkersNearCoordinates(e.lngLat.lng, e.lngLat.lat, 25, 25);
  });
}

init();
