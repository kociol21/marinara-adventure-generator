import { z } from "zod";
import {
  missingEssentials,
  requirementsSchema,
  type InterviewState,
  type Requirements,
} from "@adv/shared";
import type { ChatTurn } from "../connections/adapters.ts";
import type { InterviewRepo } from "../repos/interview.ts";
import type { ProjectsRepo } from "../repos/projects.ts";
import type { TextGenerator } from "../generation/text.ts";

/** After this many interviewer turns, offer the summary with defaults instead of asking more. */
export const MAX_INTERVIEW_TURNS = 5;
const MAX_QUESTIONS = 3;

/**
 * Questions about the hidden story defeat the purpose of the app (spec §3): the player must not
 * decide or learn secrets. The prompt forbids them; this pattern is the code-side backstop.
 */
const SPOILER_QUESTION =
  /\b(culprit|killer|murderer|who (did|killed|is behind)|whodunit|twist|secret|secretly|hidden motive|motive|really (is|wants|hiding)|betray\w*|solution|solve[sd]?|ending|endgame|final reveal|reveal|plot twist|villain('s)? plan|true identity)\b/i;

export function isSpoilerQuestion(question: string): boolean {
  return SPOILER_QUESTION.test(question);
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * mustInclude is for plot details the player imposes beyond the other fields. Models tend to
 * paste the whole pitch into it, which would later read as hard plot constraints; drop items
 * that are just copied from the pitch or the starting situation.
 */
export function cleanMustInclude(items: string[], idea: string, startingSituation: string): string[] {
  const sources = [normalize(idea), normalize(startingSituation)].filter(Boolean);
  return items.filter((item) => {
    const n = normalize(item);
    return n.length > 0 && !sources.some((src) => src.includes(n));
  });
}

export const interviewTurnSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  questions: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
  requirements: requirementsSchema,
  assumptions: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  readyForSummary: z.boolean().default(false),
});
export type InterviewTurn = z.infer<typeof interviewTurnSchema>;

const FIELD_GUIDE = `Requirements JSON fields:
- idea: leave as given (the app keeps the player's original pitch).
- genre: main genre, e.g. "noir detective mystery". subgenres: extra genres blended in.
- tone: list of mood words, e.g. ["gritty", "melancholic", "wry humor"].
- narration: { pov: "second"|"third"|"first", tense: "present"|"past", style, inspirations, intensity }.
  style: the prose voice in a sentence or two (rhythm, imagery, diction, how dialogue sounds), e.g. "terse hard-boiled sentences, wry similes, rain-soaked imagery, clipped dialogue".
  inspirations: authors, works or traditions whose STYLE the writing should echo, e.g. ["Raymond Chandler", "Dashiell Hammett"]. Style only: never their plots or characters.
  intensity: "light" (descriptive material keeps a hint of the voice) or "strong" (everything leans into it). Play text (greetings, dialogue examples, the opening) always uses the full voice.
- setting: { era, place, technology, supernatural (how magic/fantasy works at a world level, no plot), notes }.
- startingSituation: where the protagonist is and what is happening as play begins, as the player described it. Do not add hidden causes.
- protagonist: { mode, notes }. mode is "new" (the generator writes a persona) unless the player says they will use their own existing Marinara persona; describing who they play ("I am a private investigator") still means "new", with that description in notes.
- maxNpcCards: upper limit of full NPC character cards (1-8). The protagonist does not count. More minor characters can live in lorebooks.
- scale: { length, notes }. length: "one-shot" = one short session, "short" = one or two sessions, "medium" = a few sessions, "long" = a campaign.
- content: { violence: "none"|"mild"|"moderate"|"graphic", romance: "none"|"background"|"possible"|"central", sexualContent: "none"|"fade-to-black"|"explicit", horror: "none"|"light"|"strong", hardLimits: topics that must never appear, notes }.
- visualStyle: art direction for character portraits.
- mustInclude: only concrete story details the player insists on that no other field captures (for example "the client must be an elf"). Never copy the pitch, the starting situation, the cast limit or any preference into it. It is usually empty. Never add details of your own.

Every assumption must also be written into its field: never list an assumption the requirements object does not contain.`;

export function interviewSystemPrompt(current: Requirements, turnsSoFar: number): string {
  const finalTurn = turnsSoFar + 1 >= MAX_INTERVIEW_TURNS;
  return `You interview a player before an adventure is generated for the Marinara Engine roleplay app.

The player wants to DISCOVER the story while playing. Therefore:
- Never invent, suggest, hint at or ask about secrets, culprits, twists, hidden motives, solutions, reveals or the ending.
- Never write story content, characters' secrets or plot ideas in your message.
- Ask only about preferences: genre, tone, narration and prose style, setting, starting situation, cast size, protagonist, length, content boundaries and visual style.

How to interview:
- Use everything the player already said; never ask for something already answered.
- Ask at most ${MAX_QUESTIONS} short questions per turn, the most important first. Prefer quick choices ("grim or wry?") over open essays.
- When something is left open and a sensible default exists, choose it, write it into the field and list it in "assumptions" (e.g. "Length: medium (a few sessions)") instead of asking.
- The player may write in any language. Always reply in English and write every requirement value in English.
- If the player volunteers a plot detail, record it in mustInclude without elaborating on it.
- Prose style matters in AI roleplay: the narrator imitates the voice of the cards and the opening. If the player has not described a style or named inspirations, ask once, offering two or three concrete options that fit the genre (e.g. "Chandler-style hard-boiled, or plainer modern prose?"). If they leave it open, propose a fitting style and list it in assumptions.
- Set readyForSummary to true once genre, tone, era, place and the starting situation are clear and nothing important is undecided.${
    finalTurn ? "\n- This is the last interview turn: ask no questions, fill every gap with defaults, list them in assumptions, and set readyForSummary to true." : ""
  }

${FIELD_GUIDE}

Current requirements draft:
${JSON.stringify(current, null, 2)}

Reply with ONLY a JSON object, no prose around it:
{"message": "1-3 friendly sentences to the player", "questions": ["..."], "requirements": { full updated requirements object }, "assumptions": ["..."], "readyForSummary": false}`;
}

function transcript(repo: InterviewRepo, projectId: string): ChatTurn[] {
  return repo.messages(projectId).map((m) => ({
    role: m.role,
    content: m.role === "assistant" && m.questions.length ? `${m.content}\n\n${m.questions.map((q) => `- ${q}`).join("\n")}` : m.content,
  }));
}

export function createInterviewService(deps: { interview: InterviewRepo; projects: ProjectsRepo; text: TextGenerator }) {
  const { interview, projects, text } = deps;

  function state(projectId: string): InterviewState {
    const current = interview.current(projectId);
    const requirements = current?.requirements ?? requirementsSchema.parse({});
    return {
      projectId,
      messages: interview.messages(projectId),
      requirements,
      assumptions: current?.assumptions ?? [],
      missing: missingEssentials(requirements),
      readyForSummary: current?.ready ?? false,
      approvedAt: current?.approvedAt ?? null,
      version: current?.version ?? 0,
    };
  }

  return {
    state,

    /** One interview turn: store the player's message, ask the text model, store its answer. */
    async reply(projectId: string, content: string): Promise<InterviewState> {
      const before = state(projectId);
      const turnsSoFar = before.messages.filter((m) => m.role === "assistant").length;
      interview.addMessage(projectId, "user", content);
      projects.setStatus(projectId, "interview");

      const turn = await text.generateJson(interviewTurnSchema, {
        projectId,
        purpose: "interview",
        system: interviewSystemPrompt(before.requirements, turnsSoFar),
        messages: transcript(interview, projectId),
      });

      // The pitch is the player's own words; the model may not rewrite it.
      const idea = before.requirements.idea || content;
      const requirements: Requirements = {
        ...turn.requirements,
        idea,
        mustInclude: cleanMustInclude(turn.requirements.mustInclude, idea, turn.requirements.startingSituation),
      };
      const questions = turn.questions.filter((q) => !isSpoilerQuestion(q)).slice(0, MAX_QUESTIONS);
      const lastTurn = turnsSoFar + 1 >= MAX_INTERVIEW_TURNS;
      const ready = (turn.readyForSummary || lastTurn) && missingEssentials(requirements).length === 0;

      interview.save(projectId, requirements, turn.assumptions, ready || lastTurn);
      interview.addMessage(projectId, "assistant", turn.message, lastTurn ? [] : questions);
      return state(projectId);
    },

    /** Manual edits from the summary form. */
    edit(projectId: string, requirements: Requirements, assumptions?: string[]): InterviewState {
      const current = state(projectId);
      interview.save(projectId, { ...requirements, idea: current.requirements.idea || requirements.idea }, assumptions ?? current.assumptions, true);
      projects.setStatus(projectId, "interview");
      return state(projectId);
    },

    approve(projectId: string): InterviewState {
      const current = state(projectId);
      if (current.version === 0) throw new ApprovalError("There is nothing to approve yet.");
      if (current.missing.length > 0) throw new ApprovalError(`Fill in first: ${current.missing.join(", ")}.`);
      interview.approve(projectId, current.version);
      projects.setStatus(projectId, "approved");
      return state(projectId);
    },
  };
}

export class ApprovalError extends Error {}

export type InterviewService = ReturnType<typeof createInterviewService>;
