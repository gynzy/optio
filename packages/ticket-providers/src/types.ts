import type { Ticket, TicketSource, TicketProviderConfig } from "@optio/shared";

export interface TicketProvider {
  readonly source: TicketSource;

  /** Fetch tickets that match the configured filters */
  fetchActionableTickets(config: TicketProviderConfig): Promise<Ticket[]>;

  /** Post a comment on a ticket */
  addComment(ticketId: string, comment: string, config: TicketProviderConfig): Promise<void>;

  /** Update ticket state */
  updateState(ticketId: string, state: "open" | "closed", config: TicketProviderConfig): Promise<void>;
}
