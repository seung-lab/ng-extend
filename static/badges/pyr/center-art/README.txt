Drop generated center images here using this structure:

center-art/
  building/
    <slug>.png
  exploration/
    <slug>.png

Supported extensions:
- .png
- .webp
- .jpg
- .jpeg

Example:
- center-art/exploration/pulley.png
- center-art/building/abacus.webp

When the generator runs, each badge shell will automatically load the matching image if it exists.

Automatic pipeline:
- `npm run badges:pyr:center-art -- --slug pulley`
- `npm run badges:pyr:center-art -- --theme exploration --limit 5`
- `npm run badges:pyr:center-art -- --all`

Safe test:
- `npm run badges:pyr:center-art:dry-run`

Notes:
- Set `OPENAI_API_KEY` before running the generator.
- The pipeline saves images into the correct theme folder and then refreshes the badge gallery automatically.
- Use `--force` if you want to overwrite an existing generated center image.
