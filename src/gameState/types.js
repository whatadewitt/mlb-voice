// JSDoc-only type declarations (no runtime cost; vitest doesn't care).
/**
 * @typedef {Object} EnrichedPlay
 * @property {string} play_id
 * @property {string} timestamp
 * @property {number} inning
 * @property {"top"|"bottom"} half
 * @property {number} outs
 * @property {number} balls
 * @property {number} strikes
 * @property {{id:number,name:string,season_stats?:Object}} batter
 * @property {{id:number,name:string,season_stats?:Object}} pitcher
 * @property {{first:?Object,second:?Object,third:?Object}} runners
 * @property {{home:number,away:number,home_team:string,away_team:string}} score
 * @property {{id:number,name:string}} on_deck
 * @property {?{type:string,velocity:number,spin?:number,location?:Object}} pitch
 * @property {?{exit_velocity:number,launch_angle:number,distance?:number,expected_ba?:number,hit_hardness?:string}} hit
 * @property {?{catch_probability?:number,sprint_speed?:number,distance_covered?:number,fielder_name?:string}} fielding
 * @property {{leverage_index?:number,win_probability?:number,wp_swing_from_prior?:number,late_and_close:boolean,risp:boolean,two_outs_risp:boolean,lead_runs:number}} derived
 * @property {string} result_text
 * @property {{half_inning:boolean,inning:boolean,score:boolean,outs:boolean}} is_state_change
 */

export const EMPTY = {};  // module-presence marker for tests
