const WebSocket = require("ws");
// Simple WebSocket connection to Gumbo API for a given game ID
function connectToGumbo(gameId) {
  //   const wsUrl = `https://ws.statsapi.mlb.com/api/v1.1/game/${gameId}/feed/live?language=en`;
  const wsUrl = `wss://ws.statsapi.mlb.com/api/v1/game/push/subscribe/gameday/${gameId}`;
  const socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("Connected to Gumbo WebSocket for game", gameId);
  };

  socket.onmessage = (event) => {
    console.log("Gumbo message:", event.data);
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };

  socket.onclose = () => {
    console.log("Gumbo WebSocket closed");
  };

  return socket;
}
// Usage: const ws = connectToGumbo('YOUR_GAME_ID');
const ws = connectToGumbo(777923);
