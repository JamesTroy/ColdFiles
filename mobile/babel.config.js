/**
 * Babel config — required by Reanimated 4 / worklets.
 *
 * Without `react-native-worklets/plugin` registered, every call into Reanimated
 * (useSharedValue, useAnimatedStyle, withTiming, etc.) crashes at runtime. The
 * SuccessFlash component is the obvious site, but Expo Router's internals also
 * use Reanimated for screen transitions, so missing-plugin = app-doesn't-launch.
 *
 * The worklets plugin MUST be the last plugin in the array. Don't reorder.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
