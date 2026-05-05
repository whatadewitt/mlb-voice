import "dotenv/config";
import OpenAI from "openai";

import game1 from "./SDatTOR.json" assert { type: "json" };
import game2 from "./ATLatWAS.json" assert { type: "json" };
import game3 from "./CHCatMIA.json" assert { type: "json" };
import game4 from "./DETatSTL.json" assert { type: "json" };

function getBalls(play) {
  const modifier = play.details.isBall ? -1 : 0;
  return play.count.balls + modifier;
}

function getStrikes(play) {
  const modifier = play.details.isStrike ? -1 : 0;
  return play.count.strikes + modifier;
}

function getGameState(game) {
  const {
    gameData,
    liveData: {
      linescore,
      plays: { currentPlay, allPlays },
    },
  } = game;

  const currentEvent = currentPlay.playEvents.pop();
  const inningHalf = currentPlay.about.halfInning;
  const inning = currentPlay.about.inning;
  const count = `${getBalls(currentEvent)}-${getStrikes(currentEvent)}`; // really interesting how much it struggled with this
  const outs = currentPlay.count.outs;
  const batter = currentPlay.matchup.batter.fullName;
  const pitcher = currentPlay.matchup.pitcher.fullName;
  const event =
    currentPlay.result?.description || currentEvent.details.description;
  const pitchType = currentEvent.details.type.description;
  const pitchVelocity = currentEvent.pitchData.startSpeed;
  const hometeam = gameData.teams.home.name;
  const awayteam = gameData.teams.away.name;
  const score = `${gameData.teams.home.abbreviation} ${linescore.teams.home.runs}, ${gameData.teams.away.abbreviation} ${linescore.teams.away.runs}`;

  const previousPlays = allPlays
    .filter(
      (play) =>
        play.about.halfInning === inningHalf && play.about.inning === inning
    )
    .filter((play) => {
      return play.result?.description;
    })
    .map((play) => `- ${play.result.description}`)
    .reverse();

  // Runners on base: 1st
  return `Inning: ${inningHalf} ${inning}
Home team: ${hometeam}
Away team: ${awayteam}
Count: ${count}
Outs: ${outs}
Batter: ${batter}
Pitcher: ${pitcher}
Event: ${event}
Pitch type: ${pitchType}
Pitch velocity: ${pitchVelocity} mph
On Deck: ${linescore.offense.onDeck.fullName}

Score: ${score}

Previous plays:
  ${previousPlays.map((play) => play).join("\n  ")}`;
}

export async function buildScript(game) {
  if (!game) {
    return "[S1] This is a dummy game. No script generated. [S2] Nope. Nothing at all. [S1]";
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const messages = [
    {
      role: "system",
      content: `
You are a two-person baseball broadcast team: a play-by-play analyst and a color commentator. Be vivid, energetic, and use real sports broadcast language. The play-by-play analyst focuses on the live action and should sound urgent, fluid, and descriptive. The color analyst adds insight, analysis, and personality—bringing context, history, and opinion.

Format each line with a speaker tag:
- Use "[S1]" for the play-by-play analyst
- Use "[S2]" for the color commentator

Alternate between speakers, and always end with an **empty tag from the other speaker** to signal the handoff:
- If the last line is [S1], the final line should be "[S2]"
- If the last line is [S2], the final line should be "[S1]"

Timing:
- Keep the dialogue between 8–14 seconds total unless it's a **home run**, in which case more excitement and extended commentary are welcome.
- For **strikeouts**, emphasize the pitch type, location, and result. Feel free to analyze the pitcher’s performance.

Speech style:
- Avoid robotic phrasing like spelling out units (e.g., say "miles per hour", not "M P H").
- It's okay to skip velocity or specifics if it keeps the broadcast flowing naturally.
- Be immersive—imagine you're calling this live for TV or radio. Use brief pauses, drama, and storytelling flair.

Startup behavior:
- Never begin with dry narration or setup. Jump right into the live call.
- If no prior plays are given, assume you're coming **back from commercial break to start a new inning**, and pick up the energy accordingly with a quick reset or intro before the action begins.
`,
    },
    {
      role: "user",
      content: `Generate the play-by-play script for this event: ${getGameState(
        game
      )}`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o", // or gpt-3.5-turbo
    messages,
    temperature: 0.9,
  });

  return completion.choices[0].message.content.replace(/\n+/g, " ");
}

let gameData;
switch (process.env.GAME) {
  case "SDatTOR":
    gameData = game1;
    break;
  case "ATLatWAS":
    gameData = game2;
    break;
  case "CHCatMIA":
    gameData = game3;
    break;
  case "DETatSTL":
    gameData = game4;
    break;
  case "Dummy":
    gameData = null;
    break;
  default:
    // throw new Error("Invalid GAME environment variable");
    console.error(
      "Invalid GAME environment variable. Defaulting to Dummy game."
    );
    gameData = null;
}

export async function sendToVoiceServer(script) {
  console.log(script);
  console.log("Post to Voice Server...");

  try {
    await fetch(process.env.VOICE_URL || "http://localhost:5025/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: script,
      }),
      // 4 minutes timeout (240000 ms)
      signal: AbortSignal.timeout ? AbortSignal.timeout(240000) : undefined,
    });
  } catch (error) {
    console.error("Error posting to Voice Server:", error);
  }
}

async function go() {
  await buildScript(gameData).then(sendToVoiceServer);
}

// go(gameData);
