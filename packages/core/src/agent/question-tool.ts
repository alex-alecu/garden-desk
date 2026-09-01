import { type AgentQuestion, AgentQuestionSchema } from "@gardendesk/shared";
import { object, objectSchema, type ToolSpec } from "./generic-tool-support.js";

function parsedQuestions(value: unknown): AgentQuestion[] {
  const items = object(value).questions;
  if (!Array.isArray(items) || items.length < 1 || items.length > 3) {
    throw new Error("invalid_questions");
  }
  return items.map((item) => {
    const result = AgentQuestionSchema.safeParse(item);
    if (!result.success) throw new Error("invalid_questions");
    return result.data;
  });
}

function questionParams(value: unknown): { questions: AgentQuestion[] } {
  return { questions: parsedQuestions(value) };
}

function answerText(questions: AgentQuestion[], answers: string[][]): string {
  const formatted = questions
    .map((item, index) => {
      const reply = answers[index]?.length ? answers[index].join(", ") : "Unanswered";
      return `${JSON.stringify(item.question)}=${JSON.stringify(reply)}`;
    })
    .join("\n");
  return `The user answered your questions:\n${formatted}\nContinue the task with these answers in mind.`;
}

const QUESTION_ITEM_SCHEMA = {
  type: "object",
  properties: {
    header: { type: "string" },
    question: { type: "string" },
    options: {
      type: "array",
      minItems: 2,
      maxItems: 5,
      items: {
        type: "object",
        properties: { label: { type: "string" }, description: { type: "string" } },
        required: ["label"],
      },
    },
    multiple: { type: "boolean" },
  },
  required: ["header", "question", "options"],
};

const MODEL_PARAMS = objectSchema(
  {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: QUESTION_ITEM_SCHEMA,
      description:
        "1-3 items. Each has header, question, 2-5 options with label and optional description, and optional multiple.",
    },
  },
  ["questions"],
);

export function questionTool(): ToolSpec {
  return {
    definition: {
      name: "question",
      description:
        "Ask 1-3 clarifying questions only when an outcome-changing decision cannot be resolved from /source. Give 2-5 choices; put a recommendation first with (Recommended). Do not add Other.",
      params: MODEL_PARAMS,
    },
    parse: questionParams,
    execute: async (value, context) => {
      if (context.askQuestion === undefined) {
        return { content: "Questions are unavailable from this agent.", failed: true };
      }
      const { questions } = value as ReturnType<typeof questionParams>;
      const outcome = await context.askQuestion(questions);
      if (outcome.dismissed) {
        return {
          content:
            "The user dismissed the questions without answering. Continue the task using your best judgment.",
          failed: false,
        };
      }
      return { content: answerText(questions, outcome.answers), failed: false };
    },
  };
}
