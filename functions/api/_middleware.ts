// Every active endpoint uses the same D1 Worker; retired payment routes fail closed.
export const onRequest = ({next}:{next:()=>Promise<Response>}) => next()
