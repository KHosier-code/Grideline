export type StadiumMetadata = {
  teamAbbreviation: string;
  venue: string;
  aliases: string[];
  latitude: number;
  longitude: number;
  indoorOutdoor: "indoor" | "outdoor";
  retractableRoof: "retractable" | "unknown" | "none";
};

// Canonical home venues. Coordinates are stadium locations; roof state is not
// inferred for retractable venues and remains unknown per game.
export const NFL_STADIUMS: StadiumMetadata[] = [
  ["ARI","State Farm Stadium",["State Farm Stadium"],33.5276,-112.2626,"indoor","retractable"],
  ["ATL","Mercedes-Benz Stadium",["Mercedes-Benz Stadium"],33.7554,-84.4010,"indoor","retractable"],
  ["BAL","M&T Bank Stadium",["M&T Bank Stadium"],39.2780,-76.6227,"outdoor","none"],
  ["BUF","Highmark Stadium",["Highmark Stadium","New Era Field"],42.7738,-78.7870,"outdoor","unknown"],
  ["CAR","Bank of America Stadium",["Bank of America Stadium"],35.2258,-80.8528,"outdoor","none"],
  ["CHI","Soldier Field",["Soldier Field"],41.8623,-87.6167,"outdoor","none"],
  ["CIN","Paycor Stadium",["Paycor Stadium","Paul Brown Stadium"],39.0954,-84.5160,"outdoor","none"],
  ["CLE","Cleveland Browns Stadium",["Huntington Bank Field","Cleveland Browns Stadium","FirstEnergy Stadium"],41.5061,-81.6995,"outdoor","none"],
  ["DAL","AT&T Stadium",["AT&T Stadium","Cowboys Stadium"],32.7473,-97.0945,"indoor","retractable"],
  ["DEN","Empower Field at Mile High",["Empower Field at Mile High","Sports Authority Field"],39.7439,-105.0201,"outdoor","none"],
  ["DET","Ford Field",["Ford Field"],42.3400,-83.0456,"indoor","none"],
  ["GB","Lambeau Field",["Lambeau Field"],44.5013,-88.0622,"outdoor","none"],
  ["HOU","NRG Stadium",["NRG Stadium","Reliant Stadium"],29.6847,-95.4107,"indoor","retractable"],
  ["IND","Lucas Oil Stadium",["Lucas Oil Stadium"],39.7601,-86.1639,"indoor","retractable"],
  ["JAX","EverBank Stadium",["EverBank Stadium","TIAA Bank Field","EverBank Field"],30.3239,-81.6373,"outdoor","unknown"],
  ["KC","GEHA Field at Arrowhead Stadium",["GEHA Field at Arrowhead Stadium","Arrowhead Stadium"],39.0489,-94.4839,"outdoor","none"],
  ["LV","Allegiant Stadium",["Allegiant Stadium"],36.0909,-115.1833,"indoor","none"],
  ["LAC","SoFi Stadium",["SoFi Stadium"],33.9535,-118.3392,"indoor","none"],
  ["LAR","SoFi Stadium",["SoFi Stadium"],33.9535,-118.3392,"indoor","none"],
  ["MIA","Hard Rock Stadium",["Hard Rock Stadium","Sun Life Stadium"],25.9580,-80.2389,"outdoor","unknown"],
  ["MIN","U.S. Bank Stadium",["U.S. Bank Stadium"],44.9738,-93.2575,"indoor","none"],
  ["NE","Gillette Stadium",["Gillette Stadium"],42.0909,-71.2643,"outdoor","none"],
  ["NO","Caesars Superdome",["Caesars Superdome","Mercedes-Benz Superdome"],29.9511,-90.0812,"indoor","none"],
  ["NYG","MetLife Stadium",["MetLife Stadium"],40.8135,-74.0745,"outdoor","none"],
  ["NYJ","MetLife Stadium",["MetLife Stadium"],40.8135,-74.0745,"outdoor","none"],
  ["PHI","Lincoln Financial Field",["Lincoln Financial Field"],39.9008,-75.1675,"outdoor","none"],
  ["PIT","Acrisure Stadium",["Acrisure Stadium","Heinz Field"],40.4468,-80.0158,"outdoor","none"],
  ["SEA","Lumen Field",["Lumen Field","CenturyLink Field"],47.5952,-122.3316,"outdoor","none"],
  ["SF","Levi's Stadium",["Levi's Stadium"],37.4032,-121.9698,"outdoor","none"],
  ["TB","Raymond James Stadium",["Raymond James Stadium"],27.9759,-82.5033,"outdoor","none"],
  ["TEN","Nissan Stadium",["Nissan Stadium","LP Field"],36.1665,-86.7713,"outdoor","none"],
  ["WAS","Northwest Stadium",["Northwest Stadium","FedExField"],38.9078,-76.8645,"outdoor","none"],
].map(([teamAbbreviation, venue, aliases, latitude, longitude, indoorOutdoor, retractableRoof]) => ({
  teamAbbreviation, venue, aliases, latitude, longitude, indoorOutdoor, retractableRoof,
})) as StadiumMetadata[];

export function stadiumFor(abbreviation: string | null | undefined, venue: string | null | undefined) {
  const normalizedVenue = venue?.trim().toLowerCase();
  if (normalizedVenue) {
    return NFL_STADIUMS.find((stadium) =>
      stadium.aliases.some((alias) => alias.toLowerCase() === normalizedVenue),
    ) ?? null;
  }
  return NFL_STADIUMS.find((stadium) => stadium.teamAbbreviation === abbreviation?.toUpperCase()) ?? null;
}