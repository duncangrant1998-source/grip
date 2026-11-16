type Diff = Record<string, unknown> | null;

export function describeAppointmentAudit(action: string, diff: Diff): string {
  switch (action) {
    case "appointment.created": return "booked this appointment";
    case "appointment.updated": return "changed the booking";
    case "appointment.confirmed": return "confirmed it with the customer";
    case "appointment.arrived": return "checked the customer in";
    case "appointment.in_progress": return "started the job";
    case "appointment.completed": return "marked it completed";
    case "appointment.cancelled": return "cancelled it";
    case "appointment.no_show": return "marked it a no-show";
    case "appointment.converted": return "created a work order from it";
    default: return action;
  }
}
