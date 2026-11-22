#!/usr/bin/env python3
"""Rebuilds adstrat-bookmark.js from the adstratParse and adstratGrabber functions in the tracker.
Run from the repo root after changing either function: python3 tools/build-bookmark.py"""
s = open('adjuster-claim-tracker.html').read()
a = s.index('function adstratParse(root) {'); b = s.index('// This function is turned into a bookmark.', a)
c = s.index('function adstratGrabber(parse) {'); d = s.index("const AS_MARK = 'ADSTRAT-CLAIMS v1';", c)
open('adstrat-bookmark.js', 'w').write("""// AdStrat bookmark for the Adjuster Claim Tracker.
// The phone/computer bookmark is a short loader that runs this file on your AdStrat claims page.
// It reads every page of your claims list (read-only) and offers "Copy for tracker".
// GENERATED from adjuster-claim-tracker.html (adstratParse + adstratGrabber) by tools/build-bookmark.py.
// Don't edit by hand: change those functions in the tracker and re-run the script.
(function () {
""" + s[a:b].rstrip() + "\n" + s[c:d].rstrip() + "\nadstratGrabber(adstratParse);\n})();\n")
print('adstrat-bookmark.js rebuilt')
