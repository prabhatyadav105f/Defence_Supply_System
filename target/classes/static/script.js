// Global variables
let map;
let markers = {};
let graph = {};
let cities = [];
let blockedRoutes = [];

let simulationState = {
    isRunning: false,
    isPaused: false,
    speed: 3,
    currentStep: 0,
    algorithm: null,
    exploredPaths: [],
    finalPath: [],
    pathLines: [],
    availableRoutes: [],
    blockedRouteLines: [],
    totalDistance: 0
};

// Initialize map
window.onload = initMap;

async function initMap() {
    await fetchCitiesFromAPI();
    createMap();
    createGraph();
    populateCityDropdowns();
    displayAvailableRoutes();
    setupEventListeners();
    populateBlockedRoutesCheckboxes();
}

async function fetchCitiesFromAPI() {
    try {
        const response = await fetch('/api/dijkstra/cities');
        cities = await response.json();
    } catch (error) {
        console.error('Error fetching cities:', error);
    }
}

function createMap() {
    map = new google.maps.Map(document.getElementById('mapContainer'), {
        center: {lat: 22.5726, lng: 78.3639},
        zoom: 5
    });

    cities.forEach(city => {
        let position = {lat: city.latitude, lng: city.longitude};
        markers[city.name] = new google.maps.Marker({
            position: position,
            map: map,
            title: city.name
        });
    });
}

// Create graph with top 3 nearest neighbors
function createGraph() {
    cities.forEach(city => {
        let distances = cities.filter(c => c.name !== city.name)
            .map(c => ({name: c.name, distance: calculateDistance(city.latitude, city.longitude, c.latitude, c.longitude)}))
            .sort((a,b)=>a.distance-b.distance);

        graph[city.name] = {};
        distances.slice(0, 3).forEach(conn => graph[city.name][conn.name] = conn.distance);
    });
}

function populateCityDropdowns() {
    let selects = [document.getElementById('startCity'), document.getElementById('endCity')];
    selects.forEach(select => {
        cities.forEach(city => {
            let option = document.createElement('option');
            option.value = city.name;
            option.textContent = city.name;
            select.appendChild(option);
        });
    });
}

function displayAvailableRoutes() {
    clearLines(simulationState.availableRoutes);
    simulationState.availableRoutes = [];

    for (let cityName in graph) {
        let city = cities.find(c => c.name === cityName);
        for (let neighborName in graph[cityName]) {
            let neighbor = cities.find(c => c.name === neighborName);
            let line = new google.maps.Polyline({
                path: [
                    {lat: city.latitude, lng: city.longitude},
                    {lat: neighbor.latitude, lng: neighbor.longitude}
                ],
                geodesic: true,
                strokeColor: '#808080',
                strokeOpacity: 0.5,
                strokeWeight: 1
            });
            line.setMap(map);
            simulationState.availableRoutes.push(line);
        }
    }
}

function populateBlockedRoutesCheckboxes() {
    const container = document.getElementById('blockedRoutesList');
    container.innerHTML = '';

    for (let cityName in graph) {
        for (let neighborName in graph[cityName]) {
            let checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = `${cityName}->${neighborName}`;
            checkbox.classList.add('blocked-route');

            let label = document.createElement('label');
            label.textContent = ` ${cityName} → ${neighborName}`;
            label.prepend(checkbox);

            container.appendChild(label);
            container.appendChild(document.createElement('br'));
        }
    }
}

function setupEventListeners() {
    document.getElementById('startSimulation').addEventListener('click', startSimulation);
    document.getElementById('playPause').addEventListener('click', togglePlayPause);
    document.getElementById('reset').addEventListener('click', resetSimulation);
    document.getElementById('speedControl').addEventListener('input', updateSpeed);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2-lat1)*Math.PI/180;
    const dLon = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R*c;
}

// Start simulation
function startSimulation() {
    const start = document.getElementById('startCity').value;
    const end = document.getElementById('endCity').value;

    blockedRoutes = Array.from(document.querySelectorAll(".blocked-route:checked"))
        .map(cb => cb.value);

    if (!start || !end) {
        alert('Select both start and end cities');
        return;
    }

    resetSimulation();

    simulationState.algorithm = dijkstra(graph, start, end, blockedRoutes);
    simulationState.isRunning = true;
    simulationState.isPaused = false;
    document.getElementById('playPause').textContent = 'Pause';
    runSimulation();
}

// Dijkstra fetch generator
async function* dijkstra(graph, start, end, blockedRoutes = []) {
    try {
        const response = await fetch('/api/dijkstra/shortestpath', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({start, end, graph, blockedRoutes})
        });

        if (!response.ok) throw new Error('Network error');

        const steps = await response.json();
        for (let step of steps) yield step;
    } catch(e) {
        console.error(e);
        yield {type:'error', message:e.message};
    }
}

function runSimulation() {
    if (!simulationState.isRunning || simulationState.isPaused) return;

    simulationState.algorithm.next().then(result => {
        if (!result.done) {
            updateVisualization(result.value);
            simulationState.currentStep++;
            setTimeout(runSimulation, getStepDelay());
        } else {
            finishSimulation();
        }
    }).catch(console.error);
}

// Visualization updates
function updateVisualization(step) {
    switch(step.type) {
        case 'explore': highlightCity(step.current, '#FFFF00'); break;
        case 'update':
            let path = reconstructPath(step.previous, document.getElementById('startCity').value, step.neighbor);
            drawPath(path, '#0000FF', 2);
            break;
        case 'finish':
            let finalPath = reconstructPath(step.previous, document.getElementById('startCity').value, document.getElementById('endCity').value);
            drawPath(finalPath, '#FF0000', 3);
            displayFinalPath(finalPath, step.distances);
            break;
    }
    document.getElementById('algorithmProgress').textContent = `Exploring: ${step.current}`;
}

function highlightCity(cityName, color) {
    let marker = markers[cityName];
    marker.setIcon({
        path: google.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: color,
        fillOpacity: 1,
        strokeWeight: 2
    });
}

function drawPath(path, color, weight=2) {
    for (let i=0;i<path.length-1;i++){
        let start = markers[path[i]].getPosition();
        let end = markers[path[i+1]].getPosition();
        let line = new google.maps.Polyline({
            path: [start,end],
            geodesic:true,
            strokeColor: color,
            strokeOpacity: 1.0,
            strokeWeight: weight
        });
        line.setMap(map);
        simulationState.pathLines.push(line);
    }
}

function reconstructPath(previous, start, end) {
    let path = [];
    let current = end;
    while(current && current!==start){
        path.unshift(current);
        current = previous[current];
    }
    if(current===start) path.unshift(start);
    return path;
}

function displayFinalPath(path, distances) {
    const endCity = document.getElementById('endCity').value;
    const totalDistance = distances[endCity];
    simulationState.finalPath = path;
    simulationState.totalDistance = totalDistance;

    document.getElementById('finalResult').innerHTML = `
        <h3>Final Path:</h3>
        <p>${path.join(" → ")}</p>
        <h3>Total Distance:</h3>
        <p>${totalDistance!==Infinity ? totalDistance.toFixed(2)+' km' : 'No path found'}</p>
    `;
    document.getElementById('finalResult').style.display='block';
    path.forEach(city=>highlightCity(city,'#00FF00'));
}

function togglePlayPause() {
    if(!simulationState.isRunning) return;
    simulationState.isPaused=!simulationState.isPaused;
    document.getElementById('playPause').textContent = simulationState.isPaused?'Play':'Pause';
    if(!simulationState.isPaused) runSimulation();
}

function finishSimulation() {
    simulationState.isRunning=false;
    document.getElementById('playPause').textContent='Play';
    document.getElementById('algorithmProgress').textContent='Simulation complete';
}

function resetSimulation() {
    simulationState.isRunning=false;
    simulationState.isPaused=false;
    simulationState.currentStep=0;
    simulationState.algorithm=null;
    simulationState.exploredPaths=[];
    simulationState.finalPath=[];
    clearLines(simulationState.pathLines);
    simulationState.pathLines=[];
    simulationState.totalDistance=0;
    document.getElementById('playPause').textContent='Play';
    document.getElementById('algorithmProgress').textContent='';
    document.getElementById('finalResult').style.display='none';
    for(let city in markers) markers[city].setIcon(null);
}

function clearLines(lines){
    lines.forEach(line=>line.setMap(null));
}

function updateSpeed(){
    simulationState.speed=document.getElementById('speedControl').value;
    document.getElementById('speedValue').textContent=simulationState.speed;
}

function getStepDelay(){
    return 1000/simulationState.speed;
}
