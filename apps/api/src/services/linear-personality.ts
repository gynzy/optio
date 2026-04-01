export function formatActionForLinear(
  toolName: string,
  input: Record<string, unknown>,
): { action: string; parameter: string } {
  const truncate = (s: string, max = 200) => (s.length > max ? s.slice(0, max) : s);

  switch (toolName) {
    case "create_task":
      return {
        action: "Creating task",
        parameter: truncate(String(input.title ?? JSON.stringify(input))),
      };
    case "list_repos":
      return { action: "Checking repositories", parameter: "" };
    case "list_tasks":
      return {
        action: "Listing tasks",
        parameter: truncate(input.state ? `state=${input.state}` : ""),
      };
    case "get_task_details":
      return { action: "Checking task details", parameter: truncate(String(input.taskId ?? "")) };
    case "cancel_task":
      return { action: "Cancelling task", parameter: truncate(String(input.taskId ?? "")) };
    case "retry_task":
      return { action: "Retrying task", parameter: truncate(String(input.taskId ?? "")) };
    case "resume_task":
      return { action: "Resuming task", parameter: truncate(String(input.taskId ?? "")) };
    case "get_cost_analytics":
      return { action: "Checking costs", parameter: "" };
    case "list_pods":
    case "get_cluster_status":
      return { action: "Checking cluster status", parameter: "" };
    default:
      return { action: toolName, parameter: truncate(JSON.stringify(input)) };
  }
}

export function formatResultForLinear(
  _toolName: string,
  result: unknown,
  isError?: boolean,
): string | undefined {
  if (result === undefined || result === null) return undefined;
  const str = typeof result === "string" ? result : JSON.stringify(result);
  if (isError) {
    return `Error: ${str.length > 500 ? str.slice(0, 500) : str}`;
  }
  return str.length > 500 ? `${str.slice(0, 500)}...` : str;
}

export function formatGreeting(userName: string): string {
  return `Hi ${userName}, let me take a look at this issue and figure out the best approach...`;
}

export function getBusyMessage(): string {
  return "I'm currently busy processing another request. Please try again in a few minutes.";
}

export function getAlreadyLockedMessage(): string {
  return "Please wait — I'm still working on your previous request.";
}

export function getStopConfirmation(): string {
  return "Stopped. All related tasks have been cancelled.";
}

export function getInterruptionNotice(): string {
  return "My session was interrupted by a restart. We'll continue when you send your next message.";
}

export function getResumeGreeting(): string {
  return "Resuming where I left off after an interruption.";
}

export function formatTerminationError(reason: string): string {
  switch (reason) {
    case "max_turns":
      return "Reached the maximum number of conversation turns. Please start a new session to continue.";
    case "max_budget":
      return "Budget limit reached. Please start a new session to continue.";
    case "execution_error":
      return "An error occurred during execution. Please try again.";
    default:
      return `Execution ended: ${reason}`;
  }
}
