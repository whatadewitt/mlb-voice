import "dotenv/config";
import { buildScript, sendToVoiceServer } from "./game.js";

const TIMESTAMP_ENDPOINT =
  "https://statsapi.mlb.com/api/v1.1/game/777811/feed/live/timestamps";
const GAME_ENDPOINT =
  "https://statsapi.mlb.com/api/v1.1/game/777811/feed/live?timecode=";
const STARTING_TIMESTAMP = "20250523_230027";

// function getBalls(play) {
//   const modifier = play.details.isBall ? -1 : 0;
//   return play.count.balls + modifier;
// }

// function getStrikes(play) {
//   const modifier = play.details.isStrike ? -1 : 0;
//   return play.count.strikes + modifier;
// }

// function getGameState(game) {
//   const {
//     gameData,
//     liveData: {
//       linescore,
//       plays: { currentPlay, allPlays },
//     },
//   } = game;

//   const currentEvent = currentPlay.playEvents.pop();
//   const inningHalf = currentPlay.about.halfInning;
//   const inning = currentPlay.about.inning;
//   const count = `${getBalls(currentEvent)}-${getStrikes(currentEvent)}`; // really interesting how much it struggled with this
//   const outs = currentPlay.count.outs;
//   const batter = currentPlay.matchup.batter.fullName;
//   const pitcher = currentPlay.matchup.pitcher.fullName;
//   const event =
//     currentPlay.result?.description || currentEvent.details.description;
//   const pitchType = currentEvent.details.type.description;
//   const pitchVelocity = currentEvent.pitchData.startSpeed;
//   const hometeam = gameData.teams.home.name;
//   const awayteam = gameData.teams.away.name;
//   const score = `${gameData.teams.home.abbreviation} ${linescore.teams.home.runs}, ${gameData.teams.away.abbreviation} ${linescore.teams.away.runs}`;

//   const previousPlays = allPlays
//     .filter(
//       (play) =>
//         play.about.halfInning === inningHalf && play.about.inning === inning
//     )
//     .filter((play) => {
//       return play.result?.description;
//     })
//     .map((play) => `- ${play.result.description}`)
//     .reverse();

//   // Runners on base: 1st
//   return `Inning: ${inningHalf} ${inning}
// Home team: ${hometeam}
// Away team: ${awayteam}
// Count: ${count}
// Outs: ${outs}
// Batter: ${batter}
// Pitcher: ${pitcher}
// Event: ${event}
// Pitch type: ${pitchType}
// Pitch velocity: ${pitchVelocity} mph
// On Deck: ${linescore.offense.onDeck.fullName}

// Score: ${score}

// Previous plays:
//   ${previousPlays.map((play) => play).join("\n  ")}`;
// }

function getTimestamps() {
  return fetch(TIMESTAMP_ENDPOINT).then((response) => response.json());
}

async function streamGameData(timestamps) {
  let startIdx = timestamps.findIndex(
    (timestamp) => timestamp === STARTING_TIMESTAMP
  );

  console.log("Starting index:", startIdx);
  let idx = startIdx;
  while (idx < timestamps.length - 1) {
    const timestamp = timestamps[idx];
    console.log("Fetching game data for timestamp:", timestamp);

    const gameData = await fetch(GAME_ENDPOINT + timestamp)
      .then((response) => response.json())
      .catch((error) => {
        console.error("Error fetching game data:", error);
        return null;
      });

    if (gameData) {
      console.log("Game data fetched successfully.");
      await buildScript(gameData).then(sendToVoiceServer);
    } else {
      console.log("No game data found for this timestamp.");
    }

    const nowTimestamp = timestamps[idx].split("_").pop();
    const nextTimestamp = timestamps[idx + 1].split("_").pop();
    const delta = Math.max(3, nextTimestamp - nowTimestamp);

    console.log(`Waiting for ${delta / 2} seconds until the next timestamp...`);
    await new Promise((resolve) => setTimeout(resolve, (delta / 2) * 1000));
    idx++;
  }
}

async function go() {
  await getTimestamps().then(streamGameData);
}

go();
