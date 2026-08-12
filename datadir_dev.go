//go:build !production

package main

// A development build keeps its state beside the real one rather than in it.
//
// Running `wails3 dev` and running the installed app used to mean one set of
// boards, agents and tokens, so anything tried out in development was there in
// the app afterwards — and anything real was there to be broken while
// developing. They are the same product but not the same install, and this is
// the whole of what makes them separate: a different directory, and a different
// keychain service, so a token stored by one is not handed to the other.
//
// Nothing copies one into the other. A development build starts empty, which is
// the point; seeding it is a matter of copying the directory by hand.
const appDirName = "XCIII-dev"

const appIsDev = true
