import { Inngest, eventType, staticSchema } from "inngest";

/**
 * Typed event definition for document.uploaded.
 *
 * Inngest v4 removed EventSchemas/fromRecord. The v4 pattern uses eventType()
 * with staticSchema<T>() for TypeScript-only type safety without runtime validation.
 */
export const documentUploaded = eventType("document.uploaded", {
  schema: staticSchema<{ documentId: string; dealId: string }>(),
});

export const inngest = new Inngest({ id: "sellside-ma" });
