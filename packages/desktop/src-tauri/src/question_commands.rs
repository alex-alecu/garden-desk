use crate::CoreBridge;
use serde_json::{Value, json};
use tauri::State;

#[tauri::command]
pub(crate) async fn cancel_agent(
    core: State<'_, CoreBridge>,
    job_id: String,
) -> Result<Value, String> {
    core.call("agent.cancel", json!({ "jobId": job_id }))
}

#[tauri::command]
pub(crate) async fn answer_agent_question(
    core: State<'_, CoreBridge>,
    run_id: String,
    question_id: String,
    answers: Value,
) -> Result<Value, String> {
    core.call(
        "agent.answerQuestion",
        json!({ "runId": run_id, "questionId": question_id, "answers": answers }),
    )
}

#[tauri::command]
pub(crate) async fn dismiss_agent_question(
    core: State<'_, CoreBridge>,
    run_id: String,
    question_id: String,
) -> Result<Value, String> {
    core.call(
        "agent.dismissQuestion",
        json!({ "runId": run_id, "questionId": question_id }),
    )
}
