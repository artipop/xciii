package utils

import (
	"encoding/json"
	"path"
	"reflect"
	"time"

	"github.com/google/uuid"

	mmModel "github.com/mattermost/mattermost/server/public/model"
)

type IDType byte

const (
	IDTypeNone       IDType = '7'
	IDTypeTeam       IDType = 't'
	IDTypeBoard      IDType = 'b'
	IDTypeCard       IDType = 'c'
	IDTypeView       IDType = 'v'
	IDTypeSession    IDType = 's'
	IDTypeUser       IDType = 'u'
	IDTypeToken      IDType = 'k'
	IDTypeBlock      IDType = 'a'
	IDTypeAttachment IDType = 'i'
)

// NewID is a globally unique identifier: a UUIDv7 in its ordinary written form,
// thirty-six characters, which is exactly what every id column holds.
//
// It was a one-character type letter followed by base32 of sixteen random
// bytes. The letter is gone because nothing ever read it — it was written and
// never parsed, and what a row is, `blocks` already says in its `type` column.
// v7 buys the two things the old form did not have: it is unique across
// machines by construction rather than by agreement, so a card carried to
// another machine cannot collide, and it sorts by the moment it was made, which
// is what lets a journal be ordered by its own key.
//
// idType is kept in the signature and ignored. Every caller says what it is
// making, at a hundred call sites, and reading like an id of a particular kind
// is worth more than the parameter costs.
func NewID(idType IDType) string {
	id, err := uuid.NewV7()
	if err != nil {
		// A worse order, never a refused id: the caller is making a row.
		return uuid.NewString()
	}
	return id.String()
}

// GetMillis is a convenience method to get milliseconds since epoch.
func GetMillis() int64 {
	return mmModel.GetMillis()
}

// GetMillisForTime is a convenience method to get milliseconds since epoch for provided Time.
func GetMillisForTime(thisTime time.Time) int64 {
	return mmModel.GetMillisForTime(thisTime)
}

// GetTimeForMillis is a convenience method to get time.Time for milliseconds since epoch.
func GetTimeForMillis(millis int64) time.Time {
	return mmModel.GetTimeForMillis(millis)
}

// SecondsToMillis is a convenience method to convert seconds to milliseconds.
func SecondsToMillis(seconds int64) int64 {
	return seconds * 1000
}

func StructToMap(v interface{}) (m map[string]interface{}) {
	b, _ := json.Marshal(v)
	_ = json.Unmarshal(b, &m)
	return
}

func intersection(a []interface{}, b []interface{}) []interface{} {
	set := make([]interface{}, 0)
	hash := make(map[interface{}]bool)
	av := reflect.ValueOf(a)
	bv := reflect.ValueOf(b)

	for i := 0; i < av.Len(); i++ {
		el := av.Index(i).Interface()
		hash[el] = true
	}

	for i := 0; i < bv.Len(); i++ {
		el := bv.Index(i).Interface()
		if _, found := hash[el]; found {
			set = append(set, el)
		}
	}

	return set
}

func Intersection(x ...[]interface{}) []interface{} {
	if len(x) == 0 {
		return nil
	}

	if len(x) == 1 {
		return x[0]
	}

	result := x[0]
	i := 1
	for i < len(x) {
		result = intersection(result, x[i])
		i++
	}

	return result
}

func IsCloudLicense(license *mmModel.License) bool {
	return license != nil &&
		license.Features != nil &&
		license.Features.Cloud != nil &&
		*license.Features.Cloud
}

func DedupeStringArr(arr []string) []string {
	hashMap := map[string]bool{}

	for _, item := range arr {
		hashMap[item] = true
	}

	dedupedArr := make([]string, len(hashMap))
	i := 0
	for key := range hashMap {
		dedupedArr[i] = key
		i++
	}

	return dedupedArr
}

func GetBaseFilePath() string {
	return path.Join("boards", time.Now().Format("20060102"))
}
