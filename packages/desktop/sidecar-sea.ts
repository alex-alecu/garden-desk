export function seaConfiguration(main: string, output: string): string {
  return `${JSON.stringify({
    main,
    output,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
  })}\n`;
}
