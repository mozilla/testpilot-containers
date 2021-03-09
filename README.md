# Multi-Account Containers

The Firefox Multi-Account Containers extension lets you carve out a separate box for each of your online lives – no more opening a different browser just to check your work email! [Learn More Here](https://blog.mozilla.org/firefox/introducing-firefox-multi-account-containers/)

[Available on addons.mozilla.org](https://addons.mozilla.org/firefox/addon/multi-account-containers/)

For more info, see: 

* [Test Pilot Product Hypothesis Document](https://docs.google.com/document/d/1WQdHTVXROk7dYkSFluc6_hS44tqZjIrG9I-uPyzevE8/edit#)
* [Shield Product Hypothesis Document](https://docs.google.com/document/d/1vMD-fH_5hGDDqNvpRZk12_RhCN2WAe4_yaBamaNdtik/edit#)


## Requirements

* node 7+ (for jpm)
* Firefox 57+


## Development

### Running Locally

#### Via WebExtensions API (web-ext)

1. Install the [web-ext](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Getting_started_with_web-ext) tool.
2. Run `web-ext run -s src/`. This launches Firefox and installs the extension automatically.

This tool provides some additional development features, such as [automatic reloading](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Getting_started_with_web-ext#Automatic_extension_reloading).

#### Via about:debugging in Firefox

1. Open the `about:debugging` page in Firefox.
2. Click on `This Firefox`.
3. Click on [Load Temporary Add-on](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Temporary_Installation_in_Firefox).
4. Select `src/manifest.json`.

Here is a [video](https://www.youtube.com/watch?v=cer9EUKegG4) that demonstrates how to do this.

### Testing

* Install dependencies:

  ```
  npm install
  ```

* Run all tests:

  ```
  npm run test
  ```

* Only run the linter:

  ```
  npm run lint
  ```

There is a timeout test that sometimes fails on certain machines, so make sure to run the tests on your clone before you make any changes to see if you have this problem.

### Distributing
#### Make the new version

1. Bump the version number in `package.json` and `manifest.json`
2. Commit the version number bump
3. Create a git tag for the version: `git tag <version>`
4. Push the tag up to GitHub: `git push --tags`

#### Publish to AMO

1. `npm run-script build`
2. [Upload the `.zip` to AMO](https://addons.mozilla.org/developers/addon/multi-account-containers/versions/submit/)

#### Publish to GitHub
Finally, we also publish the release to GitHub for those followers.

1. Download the signed `.xpi` from [the addon versions page](https://addons.mozilla.org/developers/addon/multi-account-containers/versions)
2. [Make the new release on
   GitHub](https://github.com/mozilla/multi-account-containers/releases/new)
   * Use the version number for "Tag version" and "Release title"
   * Release notes: copy the output of `git log --no-merges --pretty=format:"%h %s" <previous-version>..<new-version>`
   * Attach binaries: select the signed `.xpi` file

### Links

Facebook & Twitter icons CC-Attrib https://fairheadcreative.com.

- [License](./LICENSE.txt)
- [Contributing](./CONTRIBUTING.md)
- [Code Of Conduct](./CODE_OF_CONDUCT.md)
