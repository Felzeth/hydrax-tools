# Abyss Hide

A small script for pages that use an Abyss.to player. It helps stop Abyss-related requests from the main page and hides related browser logs and performance entries. The video player should still work normally.

Add `abyss-hide.js` to your page before the player loads.

```html
<script src="abyss-hide.js"></script>
```

You can change the settings with `window.ABYSS_HIDE_CONFIG` before loading the script.

```html
<script>
  window.ABYSS_HIDE_CONFIG = {
    guardMode: 'warn'
  };
</script>
<script src="abyss-hide.js"></script>
```
