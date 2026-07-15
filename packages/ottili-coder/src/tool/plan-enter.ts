import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { PlanState } from "@/plan/state"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "../session/schema"
import ENTER_DESCRIPTION from "./plan-enter.txt"

export const Parameters = Schema.Struct({
  goal: Schema.String,
  assumptions: Schema.optional(Schema.Array(Schema.String)),
  tasks: Schema.optional(Schema.Array(Schema.String)),
  risks: Schema.optional(Schema.Array(Schema.String)),
  tests: Schema.optional(Schema.Array(Schema.String)),
  estimate: Schema.optional(
    Schema.Struct({
      costUSD: Schema.optional(Schema.Number),
      sessions: Schema.optional(Schema.Number),
      durationMinutes: Schema.optional(Schema.Number),
    }),
  ),
  questions: Schema.optional(Schema.Array(Schema.String)),
})

export const PlanEnterTool = Tool.define(
  "plan_enter",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const planState = yield* PlanState.Service

    return {
      description: ENTER_DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          yield* session.get(ctx.sessionID)

          const materialQuestions = params.questions ?? []
          if (materialQuestions.length > 0) {
            const answers = yield* question.ask({
              sessionID: ctx.sessionID,
              questions: materialQuestions.map((text, index) => ({
                question: text,
                header: `Question ${index + 1}`,
                custom: false,
                options: [
                  { label: "Proceed", description: "Continue planning with the stated assumption" },
                  { label: "Revise", description: "Stop and let me clarify before planning" },
                ],
              })),
              tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            })
            if (answers.some((answer) => answer[0] === "Revise")) yield* new Question.RejectedError()
          }

          const { path } = yield* planState.write({
            sessionID: ctx.sessionID,
            slug: instance.project.vcs ? instance.project.vcs : undefined,
            plan: {
              goal: params.goal,
              assumptions: params.assumptions ?? [],
              tasks: params.tasks ?? [],
              risks: params.risks ?? [],
              tests: params.tests ?? [],
              estimate: params.estimate ?? {},
              questions: materialQuestions,
            },
          })

          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "plan",
            model: undefined,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: `Plan written to ${path}. The plan covers goals, assumptions, tasks, risks, tests and a cost estimate. Use the plan_exit tool when it is ready for approval.`,
            synthetic: true,
          } satisfies SessionV1.TextPart)

          return {
            title: "Plan recorded",
            output: `Plan persisted at ${path}`,
            metadata: { path },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
