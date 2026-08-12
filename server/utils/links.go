package utils

import "fmt"

// MakeCardLink creates fully qualified card links based on card id and parents.
func MakeCardLink(serverRoot string, teamID string, boardID string, cardID string) string {
	return fmt.Sprintf("%s/team/%s/%s/0/%s", serverRoot, teamID, boardID, cardID)
}

func MakeBoardLink(serverRoot string, teamID string, board string) string {
	return fmt.Sprintf("%s/team/%s/%s", serverRoot, teamID, board)
}
