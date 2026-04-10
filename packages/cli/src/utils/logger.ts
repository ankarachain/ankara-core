import chalk from "chalk";

export const logger = {
  info:    (msg: string) => console.log(chalk.cyan("  ℹ"), msg),
  success: (msg: string) => console.log(chalk.green("  ✓"), msg),
  warn:    (msg: string) => console.log(chalk.yellow("  ⚠"), msg),
  error:   (msg: string) => console.log(chalk.red("  ✗"), msg),
  label:   (key: string, val: string) =>
    console.log(chalk.gray(`  ${key.padEnd(20)}`), chalk.white(val)),
  divider: () => console.log(chalk.gray("  " + "─".repeat(50))),
  blank:   () => console.log(),
};
