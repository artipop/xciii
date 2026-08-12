import {IntlShape} from '../../intl'

import {PropertyType, PropertyTypeEnum, FilterValueType} from '../types'

import MultiPerson from './multiperson'

export default class MultiPersonProperty extends PropertyType {
    Editor = MultiPerson
    name = 'MultiPerson'
    type = 'multiPerson' as PropertyTypeEnum
    displayName = (intl: IntlShape) => intl.formatMessage({id: 'PropertyType.MultiPerson', defaultMessage: 'Multi person'})
    canFilter = true
    filterValueType = 'person' as FilterValueType
}
