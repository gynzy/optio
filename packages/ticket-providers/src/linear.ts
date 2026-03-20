import { TicketSource, type Ticket, type TicketProviderConfig } from "@optio/shared";
import type { TicketProvider } from "./types.js";

export class LinearTicketProvider implements TicketProvider {
  readonly source = TicketSource.LINEAR;

  async fetchActionableTickets(_config: TicketProviderConfig): Promise<Ticket[]> {
    throw new Error("Linear provider not yet implemented");
  }

  async addComment(_ticketId: string, _comment: string, _config: TicketProviderConfig): Promise<void> {
    throw new Error("Linear provider not yet implemented");
  }

  async updateState(_ticketId: string, _state: "open" | "closed", _config: TicketProviderConfig): Promise<void> {
    throw new Error("Linear provider not yet implemented");
  }
}
