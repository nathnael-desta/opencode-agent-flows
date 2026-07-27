# Host the documentation

The Docsify site is static: GitHub Pages can serve the existing `docs/`
directory directly. There is no build command, generated bundle, or hosting
service to maintain.

## GitHub Pages

After the documentation changes are on the repository's default branch:

1. Open the GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the default branch and the `/docs` folder.
5. Save and wait for GitHub to publish the site.

For this repository the expected address is:

```text
https://nathnael-desta.github.io/opencode-agent-flows/
```

Put that URL in the repository's **Website** field and at the top of the root
README so visitors can open the full reference in one click.

The checked-in `docs/.nojekyll` file tells GitHub Pages to serve Docsify's files,
including `_sidebar.md` and `_coverpage.md`, without Jekyll processing.

## Local preview

```bash
bun run docs:serve
```

Then open <http://localhost:3000>.

## Dark mode

The site loads Docsify v5's official Core Dark add-on. It follows the visitor's
operating-system or browser `prefers-color-scheme` setting automatically:

- light system appearance → light documentation
- dark system appearance → dark documentation

This requires no JavaScript or saved tracking state. A manual theme button can
be added later if visitors need to override their system setting.

## Custom domain

GitHub Pages can also serve a custom domain. Configure it in **Settings →
Pages**, then add a `CNAME` file under `docs/` containing that domain. Enable
**Enforce HTTPS** after DNS validation succeeds.
