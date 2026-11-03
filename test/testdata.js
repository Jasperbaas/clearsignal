/* Demo data: [status, score, quotes, explanation, missing information] */
const CA = "cannot_assess", OB = "observed", NO = "not_observed";
const DEMO = {
  A: {
    1: [CA, null, [], "Uses \"BREAKING\" and \"Tonight\", but whether the timing matches real events cannot be judged from the text alone.", "The text gives no date or link, so it cannot be compared with real events."],
    2: [OB, 5, ["WORLD WAR 3 HAS BEGUN", "our cities burn"], "Capitals and catastrophic wording create fear while no source or evidence is given."],
    3: [CA, null, [], "Only one text was supplied, so repetition across media cannot be checked.", "How other outlets and accounts worded the same story."],
    4: [OB, 4, ["Tonight the enemy launched hundreds of missiles"], "A major claim with no source, place, named actor or link to evidence."],
    5: [OB, 3, ["the enemy"], "The attacker is an unnamed \"enemy\": a simple villain frame without context."],
    6: [OB, 4, ["the cowards who stayed silent"], "Divides readers into brave insiders and cowardly outsiders."],
    7: [OB, 4, ["Experts agree this is the end of peace"], "Relies on unnamed experts whose claim cannot be checked."],
    8: [OB, 5, ["Share this before it gets deleted."], "Pushes readers to share immediately, leaving no time to verify."],
    9: [OB, 5, ["the world will never be the same"], "Frames the event as unprecedented and world-changing."],
    10: [CA, null, [], "No links, donations or calls to vote appear; who benefits needs outside information.", "Who runs the account and how it is funded."],
    11: [OB, 4, ["the mainstream media is hiding it from you"], "Dismisses other sources as hiding the truth instead of engaging with them."],
    12: [OB, 5, ["Either we strike back now or our cities burn."], "Presents only two extreme options."],
    13: [OB, 4, ["Millions have already seen the footage."], "Uses popularity as a reason to believe the claim."],
    14: [OB, 4, ["War is here. War is coming to your street."], "The word \"war\" and its threat are repeated to keep fear high."],
    15: [OB, 3, ["hundreds of missiles"], "A large number is given without any source or base."],
    16: [OB, 4, ["Experts agree this is the end of peace"], "Appeal to unnamed authority: agreement is claimed but cannot be checked."],
    17: [OB, 4, ["the cowards who stayed silent will regret it"], "Insults and anger go far beyond the facts the text provides."],
    18: [OB, 4, ["BREAKING: WORLD WAR 3 HAS BEGUN."], "The opening line claims a world war; the body gives no evidence for it."],
    19: [CA, null, [], "The text tells readers to wake up, but whether anyone changed behaviour is not visible.", "Independent reporting on whether people actually changed behaviour."],
    20: [OB, 4, ["Just like 1939"], "Compares the moment to the start of the Second World War."]
  },
  B: {
    1: [CA, null, [], "Mentions \"Overnight\" and \"Sunday\" but gives no full date; timing against other events needs outside information.", "The full date and what else happened at that time."],
    2: [NO, 1, [], "Calm, factual wording; no fear or outrage language."],
    3: [CA, null, [], "Only one text was supplied, so repetition across media cannot be checked.", "How other outlets reported the same events."],
    4: [NO, 1, [], "Claims are attributed to the ministry, a spokesperson and the aviation authority; the other side was asked for comment."],
    5: [NO, 1, [], "No hero or villain framing."],
    6: [NO, 1, [], "No us-versus-them language."],
    7: [NO, 1, [], "Sources are identified by role: defence ministry, spokesperson, aviation authority."],
    8: [NO, 1, [], "No calls to act."],
    9: [NO, 1, [], "No claims that the event is unprecedented."],
    10: [CA, null, [], "No links or calls to action; who benefits cannot be judged from the text.", "Who publishes this report and how it is funded."],
    11: [NO, 1, [], "No critics are dismissed or labelled."],
    12: [NO, 1, [], "No either/or choice is presented."],
    13: [NO, 1, [], "No appeal to popularity."],
    14: [NO, 1, [], "No emotional word is repeated."],
    15: [OB, 2, ["most of the drones and missiles"], "\"Most\" and \"majority\" are used without figures, so the scale cannot be checked."],
    16: [NO, 1, [], "No flawed argument is used against critics."],
    17: [NO, 1, [], "No outrage language."],
    18: [NO, 1, [], "No headline is given and the body makes no claims beyond its sources."],
    19: [CA, null, [], "The text reports no behaviour change that could be checked.", "Independent reporting on public reactions."],
    20: [NO, 1, [], "No historical comparison."]
  }
};


function demoRaw(key) {
  const d = DEMO[key];
  return { indicators: IND.map(def => { const [status, score, quotes, explanation, missing] = d[def.id]; return { id: def.id, status, score, quotes, explanation, missing_information: missing || null, further_questions: [] }; }), questions_to_ask_next: [] };
}


module.exports={DEMO,demoRaw};
